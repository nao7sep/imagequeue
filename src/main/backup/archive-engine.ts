import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { ArchivedStore } from '../config/storage-root'
import { utcStampForFilename } from '../../shared/utc-stamp'
import { serializeError } from '../../shared/serialize-error'
import { syncDirectory, syncFile } from '../utils/fsync'
import { archivesToThin } from './archive-thinning'

interface ManifestEntry extends ArchivedStore {
  sha256?: string
  skipped?: string
}
export interface ArchiveManifest {
  writtenAtUtc: string
  entries: ManifestEntry[]
}
export interface ArchiveResult {
  warnings: Array<{ path: string; error: ReturnType<typeof serializeError> }>
  archivePath?: string
}

function claimLock(file: string): number | null {
  try { return fs.openSync(file, 'wx') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return null
}

// The temporary files a run writes beside its lock; only the lock holder writes them.
const TEMPORARY_NAME = /^(snapshot|archive)-.+\.tmp$/

function archiveDirectory(root: string): string {
  return path.join(root, 'backups')
}

function archiveNames(directory: string): string[] {
  return fs.readdirSync(directory).filter((name) => /^\d{8}-\d{6}-\d{3}-utc\.zip$/.test(name)).sort().reverse()
}

export async function archiveStores(root: string, stores: ArchivedStore[], now: Date = new Date()): Promise<ArchiveResult> {
  const result: ArchiveResult = { warnings: [] }
  const directory = archiveDirectory(root)
  const lock = path.join(directory, '.lock')
  let descriptor: number | null = null
  let staging: string | undefined
  try {
    fs.mkdirSync(directory, { recursive: true })
    descriptor = claimLock(lock)
    if (descriptor === null) {
      result.warnings.push({ path: lock, error: serializeError(new Error('Archive skipped: the lock is held by another run')) })
      return result
    }
    fs.writeFileSync(descriptor, String(process.pid))
    const entries: ManifestEntry[] = []
    const contents: Record<string, Uint8Array> = {}
    for (const store of stores) {
      const snapshot = path.join(directory, `snapshot-${nanoid()}.tmp`)
      let database: DatabaseSync | undefined
      try {
        database = new DatabaseSync(store.path, { readOnly: true, timeout: 500 })
        database.prepare('VACUUM INTO ?').run(snapshot)
        database.close()
        database = undefined
        const bytes = fs.readFileSync(snapshot)
        entries.push({ ...store, sha256: createHash('sha256').update(bytes).digest('hex') })
        contents[store.entryName] = bytes
      } catch (error) {
        entries.push({ ...store, skipped: String((error as Error).message ?? error) })
        result.warnings.push({ path: store.path, error: serializeError(error) })
      } finally {
        try { database?.close(); fs.rmSync(snapshot, { force: true }) } catch (error) {
          result.warnings.push({ path: store.path, error: serializeError(error) })
        }
      }
    }
    if (Object.keys(contents).length === 0) return result
    const existing = archiveNames(directory)
    if (existing[0]) {
      try {
        const bytes = unzipSync(fs.readFileSync(path.join(directory, existing[0])), { filter: (file) => file.name === 'manifest.json' })
        const previous = JSON.parse(strFromU8(bytes['manifest.json'])) as ArchiveManifest
        if (JSON.stringify(previous.entries) === JSON.stringify(entries)) return result
      } catch (error) {
        result.warnings.push({ path: path.join(directory, existing[0]), error: serializeError(error) })
      }
    }
    const manifest: ArchiveManifest = { writtenAtUtc: now.toISOString(), entries }
    contents['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
    const destination = path.join(directory, `${utcStampForFilename(now)}.zip`)
    staging = path.join(directory, `archive-${nanoid()}.tmp`)
    fs.writeFileSync(staging, zipSync(contents, { level: 6 }), { flag: 'wx' })
    syncFile(staging)
    // Publish complete bytes with a no-clobber claim, even on a clock collision.
    try { fs.linkSync(staging, destination) } catch (error) {
      if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      fs.copyFileSync(staging, destination, fs.constants.COPYFILE_EXCL)
    }
    syncDirectory(directory)
    result.archivePath = destination
    for (const name of archivesToThin(archiveNames(directory), now)) fs.unlinkSync(path.join(directory, name))
  } catch (error) {
    result.warnings.push({ path: directory, error: serializeError(error) })
  } finally {
    if (staging) {
      try { fs.rmSync(staging, { force: true }) } catch (error) {
        result.warnings.push({ path: staging, error: serializeError(error) })
      }
    }
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); fs.unlinkSync(lock) } catch (error) {
        result.warnings.push({ path: lock, error: serializeError(error) })
      }
    }
  }
  return result
}

/** Clears what a run of this process left when its deadline ended it: its lock,
 *  and the temporary files that only the lock holder writes. A lock this
 *  process does not hold, or none, is left alone. */
export async function clearAbandonedRun(root: string): Promise<void> {
  const directory = archiveDirectory(root)
  const lock = path.join(directory, '.lock')
  let owner: string
  try {
    owner = await fs.promises.readFile(lock, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (owner !== String(process.pid)) return
  for (const name of await fs.promises.readdir(directory)) {
    if (TEMPORARY_NAME.test(name)) await fs.promises.rm(path.join(directory, name), { force: true })
  }
  await fs.promises.rm(lock, { force: true })
}

export async function runArchiveSession(action: 'begin' | 'finish', root: string, stores: ArchivedStore[]): Promise<ArchiveResult> {
  const directory = archiveDirectory(root)
  const running = path.join(directory, '.running')
  try {
    fs.mkdirSync(directory, { recursive: true })
    if (action === 'begin') {
      const unclean = fs.existsSync(running)
      // Startup holds Electron's single-instance lock before invoking this path.
      // A positively dead owner left this lock behind when the process crashed.
      const lock = path.join(directory, '.lock')
      if (unclean && fs.existsSync(lock)) {
        const owner = Number(fs.readFileSync(lock, 'utf8'))
        if (!Number.isInteger(owner) || owner <= 0) fs.unlinkSync(lock)
        else {
          try { process.kill(owner, 0) } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') fs.unlinkSync(lock)
          }
        }
      }
      fs.writeFileSync(running, String(process.pid))
      return unclean ? await archiveStores(root, stores) : { warnings: [] }
    }
    const result = await archiveStores(root, stores)
    fs.rmSync(running, { force: true })
    return result
  } catch (error) {
    return { warnings: [{ path: running, error: serializeError(error) }] }
  }
}
