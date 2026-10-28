import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(), probes: vi.fn(), concepts: vi.fn(),
}))
vi.mock('../../src/main/ipc-boundary', () => ({ handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler) }))
vi.mock('../../src/main/concepts/concept-store', () => ({
  listProbesWithStats: mocks.probes, listConceptRows: mocks.concepts,
  listFacetsWithStats: vi.fn(), deleteFacet: vi.fn(), deleteProbe: vi.fn(), deleteConcept: vi.fn(),
  drainSetAsideConceptStorePaths: () => [],
}))
import { registerConceptsIpc } from '../../src/main/concepts-ipc'
const event = { sender: { send: vi.fn() } } as unknown as IpcMainInvokeEvent
const invoke = (method: string, ...args: unknown[]) => mocks.handlers.get(`concepts:${method}`)!(event, ...args)
beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); registerConceptsIpc() })

describe('concept library request boundary', () => {
  it('reads one facet’s domains and concepts by its id', async () => {
    mocks.probes.mockResolvedValue([])
    mocks.concepts.mockResolvedValue([])
    await invoke('listProbes', 2)
    await invoke('listConcepts', 2)
    expect(mocks.probes).toHaveBeenCalledWith(2)
    expect(mocks.concepts).toHaveBeenCalledWith(2)
  })

  it('rejects malformed identities before admission', () => {
    for (const bad of [null, 0, -1, 1.5, '2']) {
      expect(() => invoke('listProbes', bad)).toThrow('Invalid concept library')
      expect(() => invoke('listConcepts', bad)).toThrow('Invalid concept library')
      expect(() => invoke('deleteConcept', bad)).toThrow('Invalid concept library')
    }
    expect(mocks.probes).not.toHaveBeenCalled()
    expect(mocks.concepts).not.toHaveBeenCalled()
  })
})
