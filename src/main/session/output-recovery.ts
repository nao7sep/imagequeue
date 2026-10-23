import fs from 'node:fs/promises'
import path from 'node:path'
import { claimFinalNameAsync } from '../utils/atomic-write'
import { syncDirectoryAsync } from '../utils/fsync'
import { log, serializeError } from '../logger'
import type { PendingTaskOutput, Task } from '../../shared/types'
import { isSafeOutputBaseName } from '../../shared/output-name'
import { sha256File } from '../utils/sha256-file'

export function isPendingTaskOutput(value: unknown): value is PendingTaskOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const output = value as Record<string, unknown>
  return isSafeOutputBaseName(output.baseName) && ['png', 'jpg', 'webp'].includes(output.ext as string) &&
    typeof output.sha256 === 'string' && /^[a-f0-9]{64}$/.test(output.sha256) &&
    (output.stageName === undefined || (isSafeOutputBaseName(output.stageName) && output.stageName.endsWith('.tmp')))
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


/** Explicit retry may publish only a recorded, byte-verified stage. Old orphan
 * files have no ownership evidence and are never discovered by a directory scan. */
export async function recoverRetainedOutput(
  task: Task,
  sessionDir: string,
  beforePublish: (output: PendingTaskOutput) => Promise<void>,
): Promise<boolean> {
  if (await recoverPublishedOutput(task, sessionDir)) return true
  const output = task.pendingOutput
  if (!output?.stageName) return false
  const stage = path.join(sessionDir, output.stageName)
  // An absent or substituted file is not our delivered image. Storage access
  // failures still propagate: inability to inspect is not evidence of absence.
  const stat = await fs.lstat(stage).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!stat?.isFile() || await sha256File(stage) !== output.sha256) return false
  const siblings = new Set((await fs.readdir(sessionDir)).map((name) => name.toLowerCase()))
  const suffix = new RegExp(`-${task.backend}-(\\d+)$`).exec(output.baseName)
  const stem = suffix ? output.baseName.slice(0, -suffix[1].length - 1) : output.baseName
  let ordinal = suffix ? Number(suffix[1]) : 1
  let baseName = output.baseName
  for (;;) {
    while (siblings.has(`${baseName}.${output.ext}`.toLowerCase()) || siblings.has(`${baseName}.json`.toLowerCase())) {
      baseName = `${stem}-${++ordinal}`
    }
    const next = { ...output, baseName }
    // Record every candidate before claiming it: interruption after a successful
    // claim is recovered by the ordinary final-file verification on next launch.
    await beforePublish(next)
    task.pendingOutput = next
    await syncDirectoryAsync(sessionDir)
    if (await claimFinalNameAsync(stage, path.join(sessionDir, `${baseName}.${output.ext}`))) break
    baseName = `${stem}-${++ordinal}`
  }
  // Once published, a secondary cleanup failure cannot invite regeneration.
  try {
    await syncDirectoryAsync(sessionDir)
    await fs.rm(stage, { force: true })
  } catch (error) {
    log('warn', 'Recovered image was published but staging cleanup failed', { error: serializeError(error) })
  }
  task.status = 'completed'
  task.baseName = baseName
  task.imagePath = `${baseName}.${output.ext}`
  task.error = null
  task.providerMessage = null
  delete task.pendingOutput
  return true
}
