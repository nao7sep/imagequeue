import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(), query: vi.fn(), page: vi.fn(), locate: vi.fn(), search: vi.fn(),
}))
vi.mock('../../src/main/ipc-boundary', () => ({ handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler) }))
vi.mock('../../src/main/concepts/concept-store', () => ({
  queryConceptLibrary: mocks.query, readConceptLibraryPage: mocks.page,
  locateConceptLibraryItem: mocks.locate, searchConceptLibraryPrefix: mocks.search,
  listFacetsWithStats: vi.fn(), deleteFacet: vi.fn(), deleteProbe: vi.fn(), deleteConcept: vi.fn(),
  drainSetAsideConceptStorePaths: () => [],
}))
import { registerConceptsIpc } from '../../src/main/concepts-ipc'
const event = { sender: { send: vi.fn() } } as unknown as IpcMainInvokeEvent
const query = { facetId: 1, filter: 'words', useFilter: 'all' }
const invoke = (method: string, ...args: unknown[]) => mocks.handlers.get(`concepts:${method}`)!(event, ...args)
beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); registerConceptsIpc() })

describe('concept library request boundary', () => {
  it('passes each paged request to the worker with its revision and identity', async () => {
    mocks.query.mockResolvedValue({ revision: 'r', groups: [], totalConceptCount: 0 })
    await expect(invoke('queryConceptLibrary', query)).resolves.toEqual({ revision: 'r', groups: [], totalConceptCount: 0 })
    await invoke('readConceptLibraryPage', query, 'r', 2, 32)
    expect(mocks.page).toHaveBeenCalledWith(query, 'r', 2, 32)
    const item = { kind: 'concept', id: 3 }
    await invoke('locateConceptLibraryItem', query, 'r', item)
    expect(mocks.locate).toHaveBeenCalledWith(query, 'r', item)
    const after = { probeId: 2, offset: -1 }
    await invoke('searchConceptLibraryPrefix', query, 'r', 'text', after)
    expect(mocks.search).toHaveBeenCalledWith(query, 'r', 'text', after)
  })

  it('rejects malformed filters, identities, revisions and positions before admission', () => {
    for (const bad of [null, {}, { ...query, facetId: 0 }, { ...query, facetId: 1.2 }, { ...query, filter: null }, { ...query, useFilter: 'other' }]) {
      expect(() => invoke('queryConceptLibrary', bad)).toThrow('Invalid concept library')
    }
    for (const args of [[query, null, 2, 0], [query, 'r', -1, 0], [query, 'r', 2, -1], [query, 'r', 2, Infinity], [query, 'r', 2, 0.5]]) {
      expect(() => invoke('readConceptLibraryPage', ...args)).toThrow('Invalid concept library')
    }
    for (const item of [null, { kind: 'other', id: 3 }, { kind: 'concept', id: '3' }]) {
      expect(() => invoke('locateConceptLibraryItem', query, 'r', item)).toThrow('Invalid concept library')
    }
    for (const after of [undefined, 3, {}, { probeId: 2, offset: -2 }]) {
      expect(() => invoke('searchConceptLibraryPrefix', query, 'r', 'x', after)).toThrow('Invalid concept library')
    }
    expect(() => invoke('searchConceptLibraryPrefix', query, 'r', null, null)).toThrow('Invalid concept library')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.page).not.toHaveBeenCalled()
    expect(mocks.locate).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
})
