import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderHttpError, ProviderRefusalError } from '../../src/main/provider-errors'
import { log } from '../../src/main/logger'
import '../../src/main/ipc-boundary'

// A provider failure resolves the brainstorm handler as a typed result carrying
// what the renderer presents, whether the provider refused and its cleaned
// reason. Unexpected setup failures still reject through the generic IPC owner.
type Handler = (...args: unknown[]) => unknown
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), brainstormPrompts: vi.fn(), cancelBrainstorm: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler) },
}))
vi.mock('../../src/main/brainstorm', () => ({ brainstormPrompts: mocks.brainstormPrompts, cancelBrainstorm: mocks.cancelBrainstorm }))
vi.mock('../../src/main/logger', async () => ({
  log: vi.fn(),
  serializeError: (await import('../../src/shared/serialize-error')).serializeError,
}))

const { registerElaboratorsIpc } = await import('../../src/main/elaborators-ipc')
registerElaboratorsIpc()

let sender: EventEmitter & { send: ReturnType<typeof vi.fn> }
function brainstorm(): unknown {
  return mocks.handlers.get('elaborators:brainstorm')!({ sender }, { requestId: 'r1' })
}

beforeEach(() => {
  mocks.brainstormPrompts.mockReset()
  mocks.cancelBrainstorm.mockReset()
  vi.mocked(log).mockClear()
  sender = Object.assign(new EventEmitter(), { send: vi.fn() })
})

describe('elaborators:brainstorm outcomes', () => {
  it('resolves the prompts on success', async () => {
    mocks.brainstormPrompts.mockResolvedValue({ prompts: [] })
    await expect(brainstorm()).resolves.toEqual({ ok: true, prompts: [] })
  })
  it('resolves a refusal as a refused failure', async () => {
    mocks.brainstormPrompts.mockRejectedValue(new ProviderRefusalError('refused', 'SAFETY', 'Blocked for safety.'))
    await expect(brainstorm()).resolves.toEqual({ ok: false, failure: { refused: true, providerMessage: 'Blocked for safety.' } })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('warn', 'Brainstorm provider request failed', expect.any(Object))
  })
  it('resolves a 503 with the provider\'s reason as a failure that is not a refusal', async () => {
    mocks.brainstormPrompts.mockRejectedValue(new ProviderHttpError('busy', 503, 'The model is overloaded.'))
    await expect(brainstorm()).resolves.toEqual({ ok: false, failure: { refused: false, providerMessage: 'The model is overloaded.' } })
  })
  it('delivers partial prompt credits alongside a cleaned failure', async () => {
    const prompts = [{ text: 'kept', concepts: [{ facet: 'color', concept: 'blue' }] }]
    mocks.brainstormPrompts.mockResolvedValue({ prompts, failure: new ProviderHttpError('busy', 503, 'Unavailable.') })
    await expect(brainstorm()).resolves.toEqual({ ok: false, prompts, failure: { refused: false, providerMessage: 'Unavailable.' } })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('error', 'Brainstorm failed', expect.any(Object))
  })
  it.each([false, true])('logs one complete operational diagnostic and returns safe failure with partial prompts=%s', async (partial) => {
    const cause = new Error('TypeError EACCES /internal/provider SENTINEL cause')
    const failure = new Error('TypeError EACCES /internal/planning SENTINEL failure', { cause })
    const prompts = partial ? [{ text: 'kept', concepts: [{ facet: 'color', concept: 'blue' }] }] : []
    const failureContext = {
      requestId: 'r1', backend: 'openai', model: 'test-model', collected: prompts.length,
      durationMs: 120, planningCall: { call: 'domains', durationMs: 45 },
    }
    mocks.brainstormPrompts.mockResolvedValue({ prompts, failure, failureContext })

    const outcome = await brainstorm()
    expect(outcome).toEqual({ ok: false, prompts, failure: { refused: false, providerMessage: null } })
    expect(JSON.stringify(outcome)).not.toContain('SENTINEL')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('error', 'Brainstorm failed', {
      ...failureContext,
      error: expect.objectContaining({
        name: 'Error', message: failure.message, stack: failure.stack,
        cause: expect.objectContaining({ name: 'Error', message: cause.message, stack: cause.stack }),
      }),
    })
    for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
      expect(sender.listenerCount(event)).toBe(0)
    }
  })
  it('rejects any other failure unchanged', async () => {
    const original = new Error('Text AI is not configured.')
    mocks.brainstormPrompts.mockRejectedValue(original)
    await expect(brainstorm()).rejects.toBe(original)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('error', 'IPC handler failed', expect.objectContaining({ channel: 'elaborators:brainstorm' }))
  })
})


describe('brainstorm renderer lifetime', () => {
  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])('cancels on %s and removes its listeners on completion', async (event) => {
    let finish!: (value: { prompts: [] }) => void
    mocks.brainstormPrompts.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = brainstorm()
    for (const name of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
      expect(sender.listenerCount(name)).toBe(1)
    }
    if (event === 'did-start-navigation') sender.emit(event, {}, 'app://new-document', false, true)
    else sender.emit(event)
    expect(mocks.cancelBrainstorm).toHaveBeenCalledWith('r1')
    finish({ prompts: [] })
    await expect(pending).resolves.toEqual({ ok: true, prompts: [] })
    for (const name of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
      expect(sender.listenerCount(name)).toBe(0)
    }
    mocks.cancelBrainstorm.mockClear()
    sender.emit('destroyed')
    sender.emit('did-start-navigation', {}, 'app://later', false, true)
    expect(mocks.cancelBrainstorm).not.toHaveBeenCalled()
  })

  it('keeps a run alive through hiding, closing, subframe and in-place navigation', async () => {
    let finish!: (value: { prompts: [] }) => void
    mocks.brainstormPrompts.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = brainstorm()
    sender.emit('hide')
    sender.emit('close')
    sender.emit('did-start-navigation', {}, 'app://same#anchor', true, true)
    sender.emit('did-start-navigation', {}, 'app://iframe', false, false)
    expect(mocks.cancelBrainstorm).not.toHaveBeenCalled()
    finish({ prompts: [] })
    await pending
  })

  it('removes renderer listeners on provider failure and unexpected rejection', async () => {
    for (const error of [new ProviderRefusalError('refused', 'SAFETY', 'Blocked.'), new Error('unexpected')]) {
      mocks.brainstormPrompts.mockRejectedValueOnce(error)
      const pending = Promise.resolve(brainstorm())
      if (error instanceof ProviderRefusalError) await expect(pending).resolves.toMatchObject({ ok: false })
      else await expect(pending).rejects.toBe(error)
      for (const event of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
        expect(sender.listenerCount(event)).toBe(0)
      }
    }
  })
})
