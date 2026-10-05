// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createEmptySessionDraft } from '../../../../src/shared/session-draft'

// A column whose saved model is not in the list queues nothing until another
// model is chosen, and Advanced Prompting is no way around that: the column's
// own readiness decides whether it is a target, as it does for Send to All.

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
      openai: { model: 'gpt-image-1.5', params: {}, ready: false },
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
  it('does not queue to a column whose model is not in the list', async () => {
    render(<AdvancedPromptingModal onClose={() => {}} />)
    const openai = screen.getByRole('checkbox', { name: /GPT Image/ }) as HTMLInputElement
    expect(openai.disabled).toBe(true)
    expect(screen.getByText('Model not in the list')).toBeTruthy()

    const queue = await screen.findByRole('button', { name: /Queue/ })
    await waitFor(() => expect((queue as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(queue)
    await waitFor(() => expect(enqueueBatch).toHaveBeenCalledOnce())
    const units = enqueueBatch.mock.calls[0]![0] as { backend: string; model: string }[]
    expect(units.map((unit) => unit.backend)).toEqual(['grok'])
  })
})
