import fs from 'fs'
import path from 'path'
import { utcStampForFilename } from '../../shared/utc-stamp'

/**
 * Moves a file the app cannot use aside, beside itself, as
 * `<stem>-<stamp>.invalid`, and returns where it went. It never replaces a copy
 * already there: a name taken in the same second throws, like any failed
 * rename, and the file stays where it is (storage-path-conventions).
 */
export function setAsideFile(file: string): string {
  const movedTo = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-${utcStampForFilename()}.invalid`)
  if (fs.existsSync(movedTo)) {
    throw Object.assign(new Error(`EEXIST: a set-aside copy already exists, ${movedTo}`), { code: 'EEXIST' })
  }
  fs.renameSync(file, movedTo)
  return movedTo
}
