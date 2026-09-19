// Starts the main process for the live lane the way src/main/index.ts starts it,
// minus the windows, status icon, and wake lock, and drives it through the IPC
// handlers the renderer calls. Only the live test files import it, after they
// install ./electron-glue as Electron.

import { EventEmitter } from 'node:events'
import { link, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

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
  process.env.IMAGEQUEUE_HOME = home
  handlers.clear()
  const config = await import('../../../src/main/config')
  const { initLogger } = await import('../../../src/main/logger')
  const { clearTempDir } = await import('../../../src/main/dependencies/paths')
  const { materializeElaborators } = await import('../../../src/main/elaborators')
  const session = await import('../../../src/main/session')
  const { registerQueueIpc } = await import('../../../src/main/queue')
  const { queueManager } = await import('../../../src/main/queue/queue-manager')
  const { registerPreviewIpc } = await import('../../../src/main/preview-ipc')
  const { registerSettingsIpc } = await import('../../../src/main/settings-ipc')
  const { registerStateIpc } = await import('../../../src/main/state-ipc')
  const { registerDependenciesIpc } = await import('../../../src/main/dependencies-ipc')
  const { registerElaboratorsIpc } = await import('../../../src/main/elaborators-ipc')
  const { registerConceptsIpc } = await import('../../../src/main/concepts-ipc')
  const { startProcessor, stopProcessor } = await import('../../../src/main/backends')
  const { cancelAllInFlightAndWait } = await import('../../../src/main/backends/cancellation')
  const { killAllCliJobsAndWait } = await import('../../../src/main/cli-jobs')
  const { drainPendingWrites } = await import('../../../src/main/model-params')
  const { closeBackupStore } = await import('../../../src/main/backup/backup-store')

  config.ensureDataDir()
  initLogger(config.getLogsDir())
  clearTempDir()
  materializeElaborators()
  session.initSession()
  session.resetOutputTimestampAllocators()
  session.persistActiveSession()
  session.registerSessionIpc()
  registerQueueIpc()
  registerPreviewIpc()
  registerSettingsIpc(async () => {})
  registerStateIpc()
  registerDependenciesIpc()
  registerElaboratorsIpc()
  registerConceptsIpc()
  startProcessor()

  const contents = new RendererContents()
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
      next.text_ai.backend = backend
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
          throw new Error(`The ${request.backend} task ended ${current.status}: ${current.error}`)
        }
        if (Date.now() > deadline) {
          await invoke('queue:stopAll')
          throw new Error(`The ${request.backend} task was still ${current.status} after ${TASK_TIMEOUT_MS} ms.`)
        }
        await delay(500)
      }
    },

    /** src/main/index.ts's graceful shutdown, in its order, then the renderer goes away. */
    shutdown: async (): Promise<void> => {
      stopProcessor()
      drainPendingWrites()
      await session.drainPendingDraftWrites()
      await cancelAllInFlightAndWait(5_000)
      await killAllCliJobsAndWait({ timeoutMs: 5_000 })
      if (queueManager.interruptGeneratingTasks() > 0) session.persistActiveSession()
      await session.dropCurrentSessionIfEmpty('quit')
      contents.destroy()
      closeBackupStore()
    },
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

export function requireKeys(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. The full check calls the real APIs; export ${missing.join(', ')} and run it again.`,
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
export async function readOutput(app: App, task: Task): Promise<{ bytes: Buffer; metadata: { slug: string; model: string } }> {
  const ext = task.imagePath!.slice(task.imagePath!.lastIndexOf('.') + 1)
  const bytes = await readFile(join(app.sessionDir(), task.imagePath!))
  expect(bytes.length, 'the image is not a stub').toBeGreaterThan(1024)
  expect(SIGNATURES[ext]?.(bytes), `the image is a real .${ext} file`).toBe(true)
  const metadata = JSON.parse(await readFile(join(app.sessionDir(), `${task.baseName}.json`), 'utf8')) as {
    slug: string
    model: string
  }
  return { bytes, metadata }
}
