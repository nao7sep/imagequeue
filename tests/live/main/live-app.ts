// Starts the main process for the live lane the way src/main/primary-instance.ts starts it,
// minus the windows, status icon, and wake lock, and drives it through the IPC
// handlers the renderer calls. Only the live test files import it, after they
// install ./electron-glue as Electron.

import { EventEmitter } from 'node:events'
import { link, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { expect } from 'vitest'

import type { AppConfig } from '../../../src/main/config/types'
import type { BackendId, EnqueueRequest, Task, TextAIBackendId } from '../../../src/shared/types'
import { handlers } from './electron-glue'

export const REPO = fileURLToPath(new URL('../../../', import.meta.url))
export const CACHE = join(REPO, 'node_modules', '.cache', 'imagequeue-live')
export const PROMPT = 'A red apple on a white table.'

const TASK_TIMEOUT_MS = 10 * 60_000
const TEXT_KEYS: Record<TextAIBackendId, string> = { gemini: 'GEMINI_TEXT_API_KEY', openai: 'OPENAI_TEXT_API_KEY' }

/** The renderer's web contents as the IPC handlers see it: it keeps what main sends it. */
export class RendererContents extends EventEmitter {
  readonly sent: Array<{ channel: string; payload: unknown }> = []
  #destroyed = false

  isDestroyed(): boolean {
    return this.#destroyed
  }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }

  destroy(): void {
    this.#destroyed = true
    this.emit('destroyed')
  }
}

export type App = Awaited<ReturnType<typeof startApp>>

export async function startApp(home: string) {
  process.env.IMAGEQUEUE_DATA_DIR = home
  handlers.clear()
  const config = await import('../../../src/main/config')
  const { closeRecords, openRecords } = await import('../../../src/main/records')
  const { clearTempDir } = await import('../../../src/main/dependencies/paths')
  const session = await import('../../../src/main/session')
  const { registerQueueIpc } = await import('../../../src/main/queue')
  const { queueManager } = await import('../../../src/main/queue/queue-manager')
  const { registerSettingsIpc } = await import('../../../src/main/settings-ipc')
  const { registerStateIpc } = await import('../../../src/main/state-ipc')
  const { registerDependenciesIpc } = await import('../../../src/main/dependencies-ipc')
  const { registerElaboratorsIpc } = await import('../../../src/main/elaborators-ipc')
  const { registerConceptsIpc } = await import('../../../src/main/concepts-ipc')
  const { startProcessor, stopProcessor } = await import('../../../src/main/backends')
  const { cancelAllInFlightAndWait, resetCancellationState } = await import('../../../src/main/backends/cancellation')
  const { killAllCliJobsAndWait } = await import('../../../src/main/cli-jobs')
  const { drainPendingWrites } = await import('../../../src/main/model-params')
  const { closeBackupStore } = await import('../../../src/main/backup/backup-store')

  const contents = new RendererContents()
  async function shutdown(): Promise<void> {
    const failures: unknown[] = []
    const clean = async (step: () => unknown): Promise<void> => {
      try { await step() } catch (error) { failures.push(error) }
    }
    await clean(stopProcessor)
    await clean(drainPendingWrites)
    await clean(() => session.drainPendingDraftWrites())
    await Promise.all([
      clean(() => cancelAllInFlightAndWait(5_000)),
      clean(() => killAllCliJobsAndWait({ timeoutMs: 5_000 })),
    ])
    await clean(() => { if (queueManager.interruptGeneratingTasks() > 0) session.persistActiveSession() })
    await clean(() => session.dropCurrentSessionIfEmpty('quit'))
    await clean(() => contents.destroy())
    await clean(closeBackupStore)
    await clean(closeRecords)
    if (failures.length > 0) throw new AggregateError(failures, 'Live app cleanup failed')
  }
  try {
    // The app starts once per process; this harness starts it again in the same
    // process, so the shutdown signal the last stop aborted is replaced first, or
    // every slug would take the shutdown path and fall back to a random name.
    resetCancellationState()
    config.ensureDataDir()
    openRecords(config.getDataDir())
    clearTempDir()
    session.initSession()
    session.resetOutputTimestampAllocators()
    session.persistActiveSession()
    session.registerSessionIpc()
    registerQueueIpc()
    registerSettingsIpc(async () => {})
    registerStateIpc()
    registerDependenciesIpc()
    registerElaboratorsIpc()
    registerConceptsIpc()
    startProcessor()
  } catch (error) {
    try { await shutdown() } catch (cleanupError) { console.error('Partial live app cleanup failed', cleanupError) }
    throw error
  }

  /** Invokes a handler as the renderer does; IPC copies what crosses it both ways. */
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No IPC handler for ${channel}`)
    return structuredClone(await handler({ sender: contents }, ...structuredClone(args))) as T
  }

  const task = async (backend: BackendId, id: string): Promise<Task> => {
    const all = await invoke<Record<BackendId, Task[]>>('queue:getAllStoredTasks')
    return all[backend].find((entry) => entry.id === id)!
  }

  return {
    contents,
    invoke,
    sessionDir: () => session.getSessionDir(),

    /** Selects the text AI backend in Settings, as the renderer saves it. */
    useTextBackend: async (backend: TextAIBackendId): Promise<void> => {
      const base = await invoke<AppConfig>('settings:get')
      const next = structuredClone(base)
      next.provider = backend
      await invoke('settings:saveChangedFields', base, next)
    },

    /** Enqueues one image and waits for its task to settle as completed. */
    generate: async (request: Omit<EnqueueRequest, 'count'>): Promise<Task> => {
      const [queued] = await invoke<Task[]>('queue:enqueue', { ...request, count: 1 })
      const deadline = Date.now() + TASK_TIMEOUT_MS
      for (;;) {
        const current = await task(request.backend, queued!.id)
        if (current.status === 'completed') return current
        if (current.status === 'failed' || current.status === 'interrupted') {
          throw new Error(`The ${request.backend} task ended ${current.status}: ${JSON.stringify(current.error)}`
            + `\nThe provider said: ${current.providerMessage ?? '(nothing)'}\nIts calls: ${recordedCalls(queued!.id)}`)
        }
        if (Date.now() > deadline) {
          await invoke('queue:stopAll')
          throw new Error(`The ${request.backend} task was still ${current.status} after ${TASK_TIMEOUT_MS} ms.`)
        }
        await delay(500)
      }
    },

    shutdown,
  }
}

/** Runs `body` against the app on `home`, then stops it. */
export async function withApp<T>(home: string, body: (app: App) => Promise<T>): Promise<T> {
  const app = await startApp(home)
  let result: T
  try {
    result = await body(app)
  } finally {
    await stopApp(app)
  }
  return result
}

/** Shuts the app down and proves nothing it started remains. */
export async function stopApp(app: App): Promise<void> {
  await app.shutdown()
  const open = await openAfterClosing()
  expect(open, 'no child process outlives the app').not.toContain('ProcessWrap')
  expect(open, 'no server outlives the app').not.toContain('TCPServerWrap')
}

/**
 * The process's open resources once pending closes finish: an exited child
 * releases its handle a turn of the event loop after its exit callback, so a
 * handle still open after two seconds really outlived its owner.
 */
async function openAfterClosing(): Promise<string[]> {
  const deadline = Date.now() + 2_000
  for (;;) {
    const open = process.getActiveResourcesInfo()
    const settled = !open.includes('ProcessWrap') && !open.includes('TCPServerWrap')
    if (settled || Date.now() > deadline) return open
    await delay(20)
  }
}

/** A task's recorded provider calls, so a failed paid call can be read without sending it again. */
function recordedCalls(taskId: string): string {
  const db = new DatabaseSync(join(process.env.IMAGEQUEUE_DATA_DIR!, 'records.sqlite3'), { readOnly: true })
  try {
    return JSON.stringify(db.prepare('SELECT request, response, error FROM ai_calls WHERE task_id = ? ORDER BY time').all(taskId))
  } finally {
    db.close()
  }
}

export function requireKeys(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. The full run calls the real APIs; export ${missing.join(', ')} and run it again.`,
    )
  }
}

export function textKey(backend: TextAIBackendId): string {
  return TEXT_KEYS[backend]
}

/** Hard-links every file under `from` into `to`, keeping the tree. */
export async function linkTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await linkTree(join(from, entry.name), join(to, entry.name))
    else if (entry.isFile()) await link(join(from, entry.name), join(to, entry.name))
  }
}

const SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  png: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  webp: (bytes) => bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP',
}

/** Reads a completed task's image and sidecar, proving the image is what its extension says. */
export async function readOutput(
  app: App,
  task: Task,
): Promise<{ bytes: Buffer; metadata: { slug: string; model: string; params: Record<string, unknown> } }> {
  const ext = task.imagePath!.slice(task.imagePath!.lastIndexOf('.') + 1)
  const bytes = await readFile(join(app.sessionDir(), task.imagePath!))
  expect(bytes.length, 'the image is not a stub').toBeGreaterThan(1024)
  expect(SIGNATURES[ext]?.(bytes), `the image is a real .${ext} file`).toBe(true)
  const metadata = JSON.parse(await readFile(join(app.sessionDir(), `${task.baseName}.json`), 'utf8')) as {
    slug: string
    model: string
    params: Record<string, unknown>
  }
  return { bytes, metadata }
}
