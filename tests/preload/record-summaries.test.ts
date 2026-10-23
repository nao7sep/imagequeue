import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { ElectronAPI } from '../../src/shared/electron-api'
import type { RecordIdentity, RecordSummary } from '../../src/shared/records'

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
const renderer = Object.assign(new EventEmitter(), { invoke: mocks.invoke })
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: renderer }))
await import('../../src/preload/index')
const api = mocks.expose.mock.calls[0][1] as ElectronAPI

it('returns summary results and propagates failures through the preload bridge', async () => {
  const identities: RecordIdentity[] = [{ kind: 'cli-job', id: 3 }, { kind: 'log', id: 1 }, { kind: 'ai-call', id: 2 }]
  const summaries: RecordSummary[] = [{ kind: 'log', id: 1, time: 't', level: 'info', title: 'line', text: null }]
  mocks.invoke.mockResolvedValueOnce(summaries).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('read unavailable'))
  await expect(api.readRecordSummaries(identities)).resolves.toEqual(summaries)
  expect(mocks.invoke).toHaveBeenLastCalledWith('records:summaries', identities)
  await expect(api.readRecordSummaries([])).resolves.toEqual([])
  expect(mocks.invoke).toHaveBeenLastCalledWith('records:summaries', [])
  await expect(api.readRecordSummaries(identities)).rejects.toThrow('read unavailable')
})
