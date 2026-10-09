import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../../src/main/concepts/concept-worker?nodeWorker', () => ({ default: mocks.create }))
import { closeConceptStore, CONCEPT_REQUEST_TIMEOUT_MS, ensureFacet, listFacetDisplays } from '../../../src/main/concepts/concept-store'

type Message = { id: number; op: string; args: unknown[] }
function thread() {
  const posted: Message[] = []
  return Object.assign(new EventEmitter(), {
    posted,
    postMessage: (message: Message) => { posted.push(message) },
    unref: vi.fn(),
    terminate: vi.fn().mockResolvedValue(0),
  })
}
afterEach(() => { vi.useRealTimers(); mocks.create.mockReset() })

describe('concept library serial owner', () => {
  it('keeps the same physical owner after a caller deadline and drains before closing', async () => {
    vi.useFakeTimers()
    const worker = thread()
    mocks.create.mockReturnValue(worker)
    const first = ensureFacet('place')
    const failed = expect(first).rejects.toThrow('may still finish')
    await vi.advanceTimersByTimeAsync(CONCEPT_REQUEST_TIMEOUT_MS)
    await failed
    const second = listFacetDisplays()
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(worker.terminate).not.toHaveBeenCalled()
    const closing = closeConceptStore()
    await expect(ensureFacet('late')).rejects.toThrow('closing')
    expect(worker.posted.map((message) => message.op)).toEqual(['ensureFacet', 'listFacetDisplays', 'closeConceptStore'])
    worker.emit('message', { id: worker.posted[0].id, value: { id: 1, display: 'place' }, paths: [] })
    worker.emit('message', { id: worker.posted[1].id, value: ['place'], paths: [] })
    await expect(second).resolves.toEqual(['place'])
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.emit('message', { id: worker.posted[2].id, value: undefined, paths: [] })
    await closing
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('fails admitted requests when its worker crashes without reopening a competing owner', async () => {
    const worker = thread()
    mocks.create.mockReturnValue(worker)
    const request = ensureFacet('place')
    worker.emit('error', new Error('worker failed'))
    await expect(request).rejects.toThrow('worker failed')
    await expect(listFacetDisplays()).rejects.toThrow('worker failed')
    expect(mocks.create).toHaveBeenCalledOnce()
    await closeConceptStore()
  })
})
