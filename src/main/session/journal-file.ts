import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import type { BackendId, ElaboratedPromptRecord, Task } from '../../shared/types'

export const JOURNAL_FILENAME = 'session-changes.jsonl'

export interface SessionTransition {
  sequence: number
  updatedAt: string
  upserts: Task[]
  removed: { backend: BackendId; id: string }[]
  elaboratedPrompts?: ElaboratedPromptRecord[]
}

/** A complete newline commits one record. Replay holds only the current logical
 * record; a final partial record is excluded from both replay and validBytes. */
export async function readSessionJournal(
  dir: string,
  checkpointSequence: number,
  validateTransition: (value: unknown) => value is SessionTransition,
  onTransition: (transition: SessionTransition) => void,
): Promise<{ sequence: number; validBytes: number }> {
  let handle: fs.promises.FileHandle
  try { handle = await fs.promises.open(path.join(dir, JOURNAL_FILENAME), 'r') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sequence: checkpointSequence, validBytes: 0 }
    throw error
  }
  const stream = handle.createReadStream({ autoClose: false })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let sequence = checkpointSequence
  let previous: number | undefined
  let validBytes = 0
  let fragments: Buffer[] = []
  let fragmentBytes = 0
  try {
    for await (const value of stream) {
      const chunk = value as Buffer
      let start = 0
      for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
        const part = chunk.subarray(start, end)
        const line = fragments.length === 0 ? part : Buffer.concat([...fragments, part], fragmentBytes + part.length)
        const parsed: unknown = JSON.parse(decoder.decode(line))
        if (!validateTransition(parsed)) throw new Error('Invalid session journal transition')
        const current = parsed.sequence
        if (!Number.isSafeInteger(current) || current <= 0 ||
          (previous !== undefined && current !== previous + 1) ||
          (current > checkpointSequence && current !== sequence + 1)) {
          throw new Error('Invalid session journal sequence')
        }
        previous = current
        if (current > checkpointSequence) {
          onTransition(parsed)
          sequence = current
        }
        validBytes += fragmentBytes + part.length + 1
        fragments = []
        fragmentBytes = 0
        start = end + 1
      }
      if (start < chunk.length) {
        const tail = chunk.subarray(start)
        fragments.push(tail)
        fragmentBytes += tail.length
      }
    }
    return { sequence, validBytes }
  } finally {
    stream.destroy()
    await handle.close()
  }
}

/** Caller owns serialization and retains its old offset on any failure. Retrying
 * truncates an unacknowledged tail before appending the same transition again. */
export async function appendSessionTransition(
  dir: string,
  confirmedBytes: number,
  transition: SessionTransition,
): Promise<number> {
  const bytes = Buffer.from(JSON.stringify(transition) + '\n', 'utf8')
  await fs.promises.mkdir(dir, { recursive: true })
  const file = path.join(dir, JOURNAL_FILENAME)
  let handle: fs.promises.FileHandle
  try { handle = await fs.promises.open(file, 'r+') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    handle = await fs.promises.open(file, 'wx+')
  }
  try {
    await handle.truncate(confirmedBytes)
    let written = 0
    while (written < bytes.length) {
      const result = await handle.write(bytes, written, bytes.length - written, confirmedBytes + written)
      if (result.bytesWritten === 0) throw new Error('Session journal write made no progress')
      written += result.bytesWritten
    }
    await handle.sync()
  } finally { await handle.close() }
  return confirmedBytes + bytes.length
}
