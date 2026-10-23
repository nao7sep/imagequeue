import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { ElectronAPI } from '../../src/shared/electron-api'

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
const renderer = Object.assign(new EventEmitter(), { invoke: mocks.invoke })
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: renderer }))
await import('../../src/preload/index')
const api = mocks.expose.mock.calls[0][1] as ElectronAPI

it('correlates write-start callbacks and releases each listener only at physical settlement', async () => {
  let finishFirst!: (value: { success: boolean }) => void
  let failSecond!: (error: Error) => void
  mocks.invoke.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve }))
    .mockReturnValueOnce(new Promise((_resolve, reject) => { failSecond = reject }))
  const firstStarted = vi.fn()
  const secondStarted = vi.fn()
  const first = api.saveChangedSettings({}, {}, {}, [], firstStarted)
  const second = api.saveChangedSettings({}, {}, {}, [], secondStarted)
  const firstId = mocks.invoke.mock.calls[0][5]
  const secondId = mocks.invoke.mock.calls[1][5]
  expect(firstId).not.toBe(secondId)
  renderer.emit('settings:writeStarted', {}, secondId)
  expect(firstStarted).not.toHaveBeenCalled()
  expect(secondStarted).toHaveBeenCalledOnce()
  renderer.emit('settings:writeStarted', {}, firstId)
  expect(firstStarted).toHaveBeenCalledOnce()
  expect(renderer.listenerCount('settings:writeStarted')).toBe(2)
  finishFirst({ success: true })
  await first
  expect(renderer.listenerCount('settings:writeStarted')).toBe(1)
  const failed = expect(second).rejects.toThrow('write failed')
  failSecond(new Error('write failed'))
  await failed
  expect(renderer.listenerCount('settings:writeStarted')).toBe(0)
})
