// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createEmptySessionDraft } from '../../../../src/shared/session-draft'

// A column whose saved model is not in the list still queues, with the plain
// request, and is a target here as from the column itself; its row warns that
// the model is not in the list.

vi.mock('../../../../src/renderer/src/hooks/useBrainstormOperation', () => ({
  useBrainstormOperation: () => ({ progress: null, run: vi.fn(), cancel: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {},
    apiKeyPresence: { image: { openai: true, nanobanana: true, grok: true, flux: true }, geminiText: true, openaiText: true },
  }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('../../../../src/renderer/src/context/EnqueueConfigContext', () => ({
  useEnqueueConfigs: () => ({
    snapshots: {
      openai: { model: 'gpt-image-1.5', params: {}, ready: true },
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
      promptMode: 'as-is',
      targetScope: 'selected',
      selectedProprietary: { openai: true, nanobanana: false, grok: true, flux: false, drawthings: false },
    },
    update: vi.fn(),
    appendElaboratedPrompts: vi.fn(),
  }),
}))

const { AdvancedPromptingModal } = await import('../../../../src/renderer/src/components/AdvancedPromptingModal')

let enqueueBatch: ReturnType<typeof vi.fn>

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  enqueueBatch = vi.fn().mockResolvedValue([])
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    platform: 'win32',
    appLog: vi.fn().mockResolvedValue(undefined),
    listElaborators: vi.fn().mockResolvedValue([]),
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

    const queue = await screen.findByRole('button', { name: /Queue/ })
    await waitFor(() => expect((queue as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(queue)
    await waitFor(() => expect(enqueueBatch).toHaveBeenCalledOnce())
    const units = enqueueBatch.mock.calls[0]![0] as { backend: string; model: string; params: unknown }[]
    expect(units.map(({ backend, model, params }) => ({ backend, model, params }))).toEqual([
      { backend: 'openai', model: 'gpt-image-1.5', params: {} },
      { backend: 'grok', model: 'grok-imagine-image-2.0', params: { aspectRatio: '1:1', resolution: '1k', quality: 'auto' } },
    ])
  })
})
