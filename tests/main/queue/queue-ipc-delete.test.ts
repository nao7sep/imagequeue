import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const deleteImageOutput = vi.fn()
const trashImageOutput = vi.fn(async () => undefined)

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../../src/main/session', () => ({ persistActiveSession: () => undefined }))
vi.mock('../../../src/main/config', () => ({ loadConfig: () => ({ general: { delete_to_trash: false } }) }))
vi.mock('../../../src/main/utils/file-output', () => ({
  deleteImageOutput,
  trashImageOutput,
  imageExtFromPath: () => 'png',
}))

const { registerQueueIpc } = await import('../../../src/main/queue/ipc')
const { queueManager } = await import('../../../src/main/queue/queue-manager')
registerQueueIpc()

const invokeDelete = (backend: string, taskId: string): Promise<unknown> =>
  Promise.resolve(handlers.get('queue:deleteWithFiles')!({}, backend, taskId))

beforeEach(() => {
  deleteImageOutput.mockClear()
  trashImageOutput.mockClear()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

describe('queue:deleteWithFiles', () => {
  it('refuses a task that became generating before the IPC arrived', async () => {
    const task = queueManager.enqueue({ prompt: 'p', backend: 'openai', model: 'm', params: {}, count: 1 } as never)[0]
    task.status = 'generating'
    task.baseName = 'live-output'
    task.imagePath = 'live-output.png'

    await invokeDelete('openai', task.id)

    expect(queueManager.getTask('openai', task.id)).toBe(task)
    expect(deleteImageOutput).not.toHaveBeenCalled()
    expect(trashImageOutput).not.toHaveBeenCalled()
  })

  it('still removes a non-generating task and its files', async () => {
    const task = queueManager.enqueue({ prompt: 'p', backend: 'openai', model: 'm', params: {}, count: 1 } as never)[0] as Task
    task.status = 'completed'
    task.baseName = 'done-output'
    task.imagePath = 'done-output.png'

    await invokeDelete('openai', task.id)

    expect(deleteImageOutput).toHaveBeenCalledWith('done-output', 'png')
    expect(queueManager.getTask('openai', task.id)).toBeUndefined()
  })
})
