// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createEmptySessionDraft } from '../../../../src/shared/session-draft'
import { until } from '../../until'

// A column whose saved model is not in the list still queues, with the plain
// request, and is a target here as from the column itself; its row warns that
// the model is not in the list.

const controls = vi.hoisted(() => ({ run: vi.fn(), append: vi.fn(), update: vi.fn(), fresh: false, invalidParams: false, dt: false }))

vi.mock('../../../../src/renderer/src/hooks/useBrainstormOperation', () => ({
  useBrainstormOperation: () => ({ progress: null, run: controls.run, cancel: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {},
    apiKeyPresence: { image: { openai: true, nanobanana: true, grok: true, flux: true }, geminiText: true, openaiText: true },
  }),
}))
vi.mock('../../../../src/renderer/src/hooks/useInstalledModels', () => ({
  useInstalledModels: () => ({ status: 'ready', error: null, models: controls.dt ? [{ file: 'model.ckpt', name: 'Test model' }] : [] }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('../../../../src/renderer/src/context/EnqueueConfigContext', () => ({
  useEnqueueConfigs: () => ({
    snapshots: {
      openai: { model: 'gpt-image-1.5', params: {}, ready: !controls.invalidParams, invalidParams: controls.invalidParams },
      grok: { model: 'grok-imagine-image-2.0', params: { aspectRatio: '1:1', resolution: '1k', quality: 'auto' }, ready: true },
    },
  }),
}))
vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    state: {
      ...createEmptySessionDraft(),
      elaboratedPrompts: [],
      seed: 'a fox',
      promptMode: controls.fresh ? 'fresh-task' : 'as-is',
      count: controls.fresh ? 2 : 1,
      selectedCompositionElaboratorId: 'c1',
      selectedStyleElaboratorId: 's1',
      targetScope: controls.dt ? 'all-drawthings' : 'selected',
      selectedProprietary: { openai: true, nanobanana: false, grok: true, flux: false, drawthings: false },
    },
    update: controls.update,
    appendElaboratedPrompts: controls.append,
  }),
}))

const { AdvancedPromptingModal } = await import('../../../../src/renderer/src/components/AdvancedPromptingModal')

let enqueueBatch: ReturnType<typeof vi.fn>

beforeEach(() => {
  controls.fresh = false
  controls.invalidParams = false
  controls.dt = false
  controls.run.mockReset()
  controls.append.mockReset()
  controls.update.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
  enqueueBatch = vi.fn().mockResolvedValue([])
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    platform: 'win32',
    appLog: vi.fn().mockResolvedValue(undefined),
    listElaborators: vi.fn().mockResolvedValue([
      { id: 'c1', kind: 'composition', name: 'Composition', template: 't' },
      { id: 's1', kind: 'style', name: 'Style', template: 't' },
    ]),
    enqueueBatch,
  }
})
afterEach(cleanup)

describe('Advanced Prompting targets', () => {
  it('queues to a column whose model is not in the list and warns on its row', async () => {
    render(<AdvancedPromptingModal onClose={() => {}} />)
    const openai = screen.getByRole('checkbox', { name: /GPT Image/ }) as HTMLInputElement
    expect(openai.disabled).toBe(false)
    expect(screen.getAllByText('Model not in the list')).toHaveLength(1)

    const queue = await until(() => screen.getByRole('button', { name: /Queue/ }))
    await until(() => expect((queue as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(queue)
    await until(() => expect(enqueueBatch).toHaveBeenCalledOnce())
    const units = enqueueBatch.mock.calls[0]![0] as { backend: string; model: string; params: unknown }[]
    expect(units.map(({ backend, model, params }) => ({ backend, model, params }))).toEqual([
      { backend: 'openai', model: 'gpt-image-1.5', params: {} },
      { backend: 'grok', model: 'grok-imagine-image-2.0', params: { aspectRatio: '1:1', resolution: '1k', quality: 'auto' } },
    ])
  })
})


describe('fresh prompt delivery', () => {
  const prompts = [
    { text: 'first', concepts: [{ facet: 'color', concept: 'red' }] },
    { text: 'second', concepts: [{ facet: 'color', concept: 'blue' }] },
  ]
  async function submit(): Promise<void> {
    controls.fresh = true
    render(<AdvancedPromptingModal onClose={() => {}} />)
    const queue = await until(() => screen.getByRole('button', { name: /^Queue/ }))
    await until(() => expect((queue as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(queue)
  }
  it('keeps partial credits and requires explicit submission without another paid call', async () => {
    controls.run.mockResolvedValue({ ok: false, prompts, failure: { refused: false, providerMessage: 'Unavailable' } })
    await submit()
    await until(() => screen.getByText(/Completed 2 of 4 prompts/))
    expect(enqueueBatch).not.toHaveBeenCalled()
    expect(controls.append).toHaveBeenCalledExactlyOnceWith(prompts)
    fireEvent.click(screen.getByRole('button', { name: 'Queue image tasks (2)' }))
    await until(() => expect(enqueueBatch).toHaveBeenCalledOnce())
    expect(enqueueBatch.mock.calls[0][0].map((unit: { prompt: string }) => unit.prompt)).toEqual(['first', 'second'])
    expect(controls.run).toHaveBeenCalledExactlyOnceWith(4)
    expect(controls.append).toHaveBeenCalledOnce()
  })
  it('submits complete tasks and credits together without a second history write', async () => {
    const complete = [...prompts, ...prompts.map((p) => ({ ...p, text: p.text + ' next' }))]
    controls.run.mockResolvedValue({ ok: true, prompts: complete })
    await submit()
    await until(() => expect(enqueueBatch).toHaveBeenCalledOnce())
    expect(enqueueBatch.mock.calls[0][1]).toEqual(complete)
    expect(controls.append).not.toHaveBeenCalled()
    expect(controls.update).toHaveBeenCalledWith({ elaboratedPrompts: complete })
  })
})


it.each(['cloud', 'drawthings'])('rejects an invalid %s image seed before paid prompt generation', async (backend) => {
  controls.fresh = true
  controls.invalidParams = backend === 'cloud'
  controls.dt = backend === 'drawthings'
  if (controls.dt) {
    window.electronAPI.platform = 'darwin'
    window.electronAPI.dtGetModelParams = vi.fn(async () => ({
      width: 512, height: 512, steps: 4, guidance: 1, seed: '42.5', negativePrompt: '',
    }))
  }
  render(<AdvancedPromptingModal onClose={vi.fn()} />)
  const queue = await until(() => screen.getByRole('button', { name: /^Queue/ }))
  await until(() => expect((queue as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(queue)
  await screen.findByText('Correct the seed values for the selected image models before queueing.')
  expect(controls.run).not.toHaveBeenCalled()
  expect(enqueueBatch).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})
