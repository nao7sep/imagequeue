// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createEmptySessionDraft } from '../../../../src/shared/session-draft'
import { until } from '../../until'

// A refusal cannot change on a retry, so Advanced Prompting offers no Retry for
// it; every other failure keeps Retry. The provider's reason shows either way.

const run = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/src/hooks/useBrainstormOperation', () => ({
  useBrainstormOperation: () => ({ progress: null, run, cancel: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: {}, apiKeyPresence: null }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('../../../../src/renderer/src/context/EnqueueConfigContext', () => ({ useEnqueueConfigs: () => ({ snapshots: {} }) }))
vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    state: { ...createEmptySessionDraft(), elaboratedPrompts: [], seed: 'a fox', selectedCompositionElaboratorId: 'c1', selectedStyleElaboratorId: 's1' },
    update: vi.fn(),
    appendElaboratedPrompts: vi.fn(),
  }),
}))

const { AdvancedPromptingModal } = await import('../../../../src/renderer/src/components/AdvancedPromptingModal')

beforeEach(() => {
  run.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    platform: 'win32',
    appLog: vi.fn().mockResolvedValue(undefined),
    listElaborators: vi.fn().mockResolvedValue([
      { id: 'c1', kind: 'composition', name: 'Composition', template: 't' },
      { id: 's1', kind: 'style', name: 'Style', template: 't' },
    ]),
  }
})
afterEach(cleanup)

async function elaborateFailingWith(failure: { rejects: unknown } | { resolves: unknown }): Promise<void> {
  if ('rejects' in failure) run.mockRejectedValue(failure.rejects)
  else run.mockResolvedValue(failure.resolves)
  render(<AdvancedPromptingModal onClose={() => {}} />)
  const elaborate = await until(() => screen.getByRole('button', { name: 'Elaborate' }))
  await until(() => expect((elaborate as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(elaborate)
  await until(() => screen.getByRole('alert'))
}

describe('Advanced Prompting failure Retry', () => {
  it('offers no Retry for a refused brainstorm and still shows the provider\'s reason', async () => {
    await elaborateFailingWith({ resolves: { ok: false, failure: { refused: true, providerMessage: 'Blocked for safety.' } } })
    expect(screen.getByText('Blocked for safety.')).toBeTruthy()
    expect(screen.getByText('The prompt could not be elaborated. Your current prompt is unchanged; try again.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
  it.each([
    ['a missing key', { rejects: new Error('Text AI is not configured.') }],
    ['a timeout', { rejects: Object.assign(new Error('Request timed out.'), { name: 'AbortError' }) }],
    ['a 503', { resolves: { ok: false, failure: { refused: false, providerMessage: 'The model is overloaded.' } } }],
  ])('offers Retry for %s', async (_label, failure) => {
    await elaborateFailingWith(failure)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
