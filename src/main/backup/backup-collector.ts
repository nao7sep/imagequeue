/**
 * Discovers what to back up by walking the home root under `~/.imagequeue/` and stat'ing every included
 * file. ImageQueue keeps all of its managed data directly under the root (no external roots), so the walk
 * is the whole selection. Produces the stat'd candidates for {@link selectChanged} and records a skip for
 * anything unreadable. All I/O here is metadata only — directory walks and `stat`; file contents are read
 * later, when a changed file is archived.
 *
 * Symlinks are never followed: the walk branches on the directory entry's own type
 * (`isDirectory()`/`isFile()`), and a symlink is neither, so it is neither descended nor archived.
 *
 * Case-insensitive uniqueness: two files whose archive paths fold to the same lowercased string (possible
 * only on a case-sensitive filesystem) would collide in the zip; the first is kept and the rest recorded
 * as skips, matching the storage-path conventions' case-insensitive entry rule.
 */
import fs from 'fs'
import path from 'path'
import { forHomeFile, normalize } from './archive-paths'
import { isExcludedDir, isExcludedFile } from './home-root-exclusions'
import { getHomeRoot } from './backup-paths'
import { truncateToSecondMs } from './backup-time'
import type { BackupCandidate, BackupSkip } from './backup-types'

export interface CollectedRoots {
  candidates: BackupCandidate[]
  skips: BackupSkip[]
}

export async function collectRoots(): Promise<CollectedRoots> {
  const candidates: BackupCandidate[] = []
  const skips: BackupSkip[] = []
  const seen = new Map<string, string>()

  const root = getHomeRoot()
  await walk(root, root, skips, async (fullPath, relative) => {
    if (isExcludedFile(relative)) return
    const archivePath = forHomeFile(relative)

    // Case-insensitive uniqueness: keep the first candidate for a folded path, skip later collisions.
    const key = archivePath.toLowerCase()
    const existing = seen.get(key)
    if (existing !== undefined) {
      skips.push({
        path: fullPath,
        reason: `archive path collides case-insensitively with ${existing}`,
      })
      return
    }
    seen.set(key, archivePath)

    await addCandidate(candidates, skips, fullPath, archivePath)
  }, (relativeDir) => isExcludedDir(relativeDir))

  return { candidates, skips }
}

/**
 * Recursively yields each file under `root` (relative path forward-slash normalized), skipping any
 * subdirectory the optional `pruneDir` predicate rejects. An unreadable directory is a logged skip, not a
 * throw, so the rest of the tree is still captured.
 */
async function walk(
  root: string,
  dir: string,
  skips: BackupSkip[],
  onFile: (fullPath: string, relative: string) => Promise<void>,
  pruneDir?: (relativeDir: string) => boolean
): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (err) {
    skips.push({ path: dir, reason: `could not enumerate: ${errorMessage(err)}` })
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relative = normalize(path.relative(root, fullPath))
    if (entry.isDirectory()) {
      if (!pruneDir?.(relative)) {
        await walk(root, fullPath, skips, onFile, pruneDir)
      }
    } else if (entry.isFile()) {
      await onFile(fullPath, relative)
    }
  }
}

async function addCandidate(
  candidates: BackupCandidate[],
  skips: BackupSkip[],
  sourcePath: string,
  archivePath: string
): Promise<void> {
  try {
    const stat = await fs.promises.stat(sourcePath)
    candidates.push({
      sourcePath,
      archivePath,
      sizeBytes: stat.size,
      mtimeMs: truncateToSecondMs(stat.mtimeMs),
    })
  } catch (err) {
    skips.push({ path: sourcePath, reason: `could not stat: ${errorMessage(err)}` })
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
