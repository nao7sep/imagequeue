/**
 * Resolves the backup feature's own locations under the home root, honoring IMAGEQUEUE_HOME through
 * `getDataDir()` (see the storage-path conventions). Everything the feature writes lives under
 * `~/.imagequeue/backups/`: the archives and the `index.json` ledger.
 */
import path from 'path'
import { getDataDir } from '../config'

/** The home root the backup mirrors (`~/.imagequeue/`). */
export function getHomeRoot(): string {
  return getDataDir()
}

/** The `backups/` directory holding the archives and the index. */
export function getBackupsDir(): string {
  return path.join(getDataDir(), 'backups')
}

/** The `backups/index.json` change ledger. */
export function getBackupIndexPath(): string {
  return path.join(getBackupsDir(), 'index.json')
}
