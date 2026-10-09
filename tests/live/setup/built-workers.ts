import { readdirSync } from 'node:fs'
import path from 'node:path'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import { vi } from 'vitest'

// Vitest does not apply electron-vite's ?nodeWorker transform. The full lane
// starts the built workers, keeping the real thread and SQLite boundaries.
function builtWorker(entry: string): { default: (options: WorkerOptions) => Worker } {
  return { default: (options) => {
    const dir = path.resolve('out/main')
    const file = readdirSync(dir).find((name) => name.startsWith(`${entry}-`) && name.endsWith('.js'))
    if (!file) throw new Error(`Build ImageQueue before running its live worker checks (${entry}).`)
    return new Worker(path.join(dir, file), options)
  } }
}
vi.mock('../../../src/main/records-writer-worker?nodeWorker', () => builtWorker('records-writer-worker'))
vi.mock('../../../src/main/concepts/concept-worker?nodeWorker', () => builtWorker('concept-worker'))
vi.mock('../../../src/main/backup/backup-worker?nodeWorker', () => builtWorker('backup-worker'))
vi.mock('../../../src/main/records-reader-worker?nodeWorker', () => builtWorker('records-reader-worker'))
