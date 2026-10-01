import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderHttpError, ProviderRefusalError } from '../../src/main/provider-errors'

// A provider failure resolves the brainstorm handler as a typed result carrying
// what the renderer presents, whether the provider refused and its cleaned
// reason; any other failure rejects as usual.
type Handler = (...args: unknown[]) => unknown
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), brainstormPrompts: vi.fn() }))

vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/brainstorm', () => ({ brainstormPrompts: mocks.brainstormPrompts, cancelBrainstorm: vi.fn() }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (e: unknown) => e }))

const { registerElaboratorsIpc } = await import('../../src/main/elaborators-ipc')
registerElaboratorsIpc()

function brainstorm(): unknown {
  return mocks.handlers.get('elaborators:brainstorm')!({ sender: { send: vi.fn() } }, { requestId: 'r1' })
}

beforeEach(() => { mocks.brainstormPrompts.mockReset() })

describe('elaborators:brainstorm outcomes', () => {
  it('resolves the prompts on success', async () => {
    mocks.brainstormPrompts.mockResolvedValue({ prompts: [] })
    await expect(brainstorm()).resolves.toEqual({ ok: true, prompts: [] })
  })
  it('resolves a refusal as a refused failure', async () => {
    mocks.brainstormPrompts.mockRejectedValue(new ProviderRefusalError('refused', 'SAFETY', 'Blocked for safety.'))
    await expect(brainstorm()).resolves.toEqual({ ok: false, failure: { refused: true, providerMessage: 'Blocked for safety.' } })
  })
  it('resolves a 503 with the provider\'s reason as a failure that is not a refusal', async () => {
    mocks.brainstormPrompts.mockRejectedValue(new ProviderHttpError('busy', 503, 'The model is overloaded.'))
    await expect(brainstorm()).resolves.toEqual({ ok: false, failure: { refused: false, providerMessage: 'The model is overloaded.' } })
  })
  it('rejects any other failure unchanged', async () => {
    const original = new Error('Text AI is not configured.')
    mocks.brainstormPrompts.mockRejectedValue(original)
    await expect(brainstorm()).rejects.toBe(original)
  })
})
