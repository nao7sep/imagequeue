import fs from 'node:fs/promises'
import path from 'node:path'
import type { PendingTaskOutput, Task } from '../../shared/types'
import { isSafeOutputBaseName } from '../../shared/output-name'
import { sha256File } from '../utils/sha256-file'

export function isPendingTaskOutput(value: unknown): value is PendingTaskOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const output = value as Record<string, unknown>
  return isSafeOutputBaseName(output.baseName) && ['png', 'jpg', 'webp'].includes(output.ext as string) &&
    typeof output.sha256 === 'string' && /^[a-f0-9]{64}$/.test(output.sha256)
}

/** Recover only the exact delivered bytes, never a foreign winner of the name.
 * Missing/unpublished output stays retryable; unavailable storage is an error,
 * because inability to inspect a paid effect must not erase its evidence. */
export async function recoverPublishedOutput(task: Task, sessionDir: string): Promise<boolean> {
  const output = task.pendingOutput
  if (!output) return false
  const file = path.join(sessionDir, `${output.baseName}.${output.ext}`)
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!stat?.isFile() || await sha256File(file) !== output.sha256) return false
  task.status = 'completed'
  task.baseName = output.baseName
  task.imagePath = `${output.baseName}.${output.ext}`
  task.error = null
  task.providerMessage = null
  delete task.pendingOutput
  return true
}
