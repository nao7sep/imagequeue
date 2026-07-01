/**
 * The optimistic exclude list for the `~/.imagequeue/` home root: everything under the root is backed up
 * except the entries here. Pure, so the "did we pick the right files?" decision is unit-testable.
 *
 * Captured like any durable file are the four managed files — `config.json`, `api-keys.json` (a secret;
 * secrets are backed up too, see the data-backup conventions), `elaborators.json`, and `params.json`.
 *
 * Excluded directories:
 * - `backups/` — the feature's own output; capturing it would recurse (fleet floor).
 * - `logs/` — recreatable (fleet floor).
 * - `output/` — the ENTIRE session tree (session dirs, their session.json manifests, generated images,
 *   session.log) is app output the user was handed, not the app's reloaded state; excluded wholesale.
 * - `bin/` — the re-fetchable Draw Things CLI.
 * - `temp/` — cleared at startup; scratch only.
 * - `models/` — external / re-fetchable model weights.
 *
 * Excluded files:
 * - `dependencies.json` — a re-derivable dependency cache, not durable user data.
 * - `*.tmp` — atomic-write temporaries (fleet floor).
 * - `.DS_Store` / `Thumbs.db` / `desktop.ini` — OS/file-manager folder-metadata litter, matched
 *   case-insensitively by base name at any depth (fleet floor).
 *
 * Paths are the forward-slash relative path under the root. (Symlinks are never followed: the collector's
 * walk uses the directory entry's own type, so a link is neither descended nor archived.)
 */
import { normalize } from './archive-paths'

const EXCLUDED_DIRS = ['backups', 'logs', 'output', 'bin', 'temp', 'models']

// App-specific files excluded on top of the floor. Compared against the forward-slash relative path.
const EXCLUDED_FILES = new Set(['dependencies.json'])

// OS/file-manager metadata that appears under the root just from browsing it (see the data-backup
// conventions' fleet floor). Compared against the lowercased base name at any depth.
const OS_NOISE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** True when a home-root file must not be backed up. */
export function isExcludedFile(relativePath: string): boolean {
  const path = normalize(relativePath)
  if (path.toLowerCase().endsWith('.tmp')) return true
  if (OS_NOISE_NAMES.has(baseName(path).toLowerCase())) return true
  if (EXCLUDED_FILES.has(path)) return true
  return EXCLUDED_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`))
}

/** True when a home-root subdirectory should be pruned (not descended into) during the walk. */
export function isExcludedDir(relativeDirPath: string): boolean {
  const path = normalize(relativeDirPath)
  return EXCLUDED_DIRS.includes(path)
}
