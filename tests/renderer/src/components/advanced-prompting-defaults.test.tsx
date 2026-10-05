// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createEmptySessionDraft } from '../../../../src/shared/session-draft'
import type { Elaborator } from '../../../../src/shared/types'
import { until } from '../../until'

// Opening Advanced Prompting fills its defaults on screen and saves nothing;
// the draft changes only when the user edits a field.

const update = vi.hoisted(() => vi.fn())
const draft = vi.hoisted(() => ({ seed: '', prompt: 'a cat on a shelf', composition: null as string | null }))

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
  useEnqueueConfigs: () => ({ snapshots: {} }),
}))
vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    state: {
      ...createEmptySessionDraft(),
      elaboratedPrompts: [],
      prompt: draft.prompt,
      seed: draft.seed,
      selectedCompositionElaboratorId: draft.composition,
      selectedStyleElaboratorId: 'gone',
    },
    update,
    appendElaboratedPrompts: vi.fn(),
  }),
}))

const { AdvancedPromptingModal } = await import('../../../../src/renderer/src/components/AdvancedPromptingModal')

const ELABORATORS: Elaborator[] = [
  { id: 'c1', kind: 'composition', name: 'Wide shot', template: 't' },
  { id: 'c2', kind: 'composition', name: 'Close-up', template: 't' },
  { id: 's1', kind: 'style', name: 'Watercolour', template: 't' },
]

beforeEach(() => {
  update.mockClear()
  draft.seed = ''
  draft.composition = null
  Element.prototype.scrollIntoView = vi.fn()
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    platform: 'win32',
    appLog: vi.fn().mockResolvedValue(undefined),
    listElaborators: vi.fn().mockResolvedValue(ELABORATORS),
  }
})
afterEach(cleanup)

function seedField(): HTMLTextAreaElement {
  return document.querySelector('textarea.advanced-seed') as HTMLTextAreaElement
}

describe('Advanced Prompting defaults', () => {
  it('shows the main prompt as the seed and the first elaborators as chosen, saving none of it', async () => {
    render(<AdvancedPromptingModal onClose={() => {}} />)

    expect(seedField().value).toBe('a cat on a shelf')
    expect(((await until(() => screen.getByRole('radio', { name: /Wide shot/ }))) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /Watercolour/ }) as HTMLInputElement).checked, 'a vanished choice shows the first').toBe(true)
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps a saved seed and a saved elaborator that still exists', async () => {
    draft.seed = 'a dog'
    draft.composition = 'c2'
    render(<AdvancedPromptingModal onClose={() => {}} />)

    expect(seedField().value).toBe('a dog')
    expect(((await until(() => screen.getByRole('radio', { name: /Close-up/ }))) as HTMLInputElement).checked).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })

  it('saves what the user edits, and an emptied seed stays empty', async () => {
    render(<AdvancedPromptingModal onClose={() => {}} />)

    fireEvent.click(await until(() => screen.getByRole('radio', { name: /Close-up/ })))
    expect(update).toHaveBeenCalledWith({ selectedCompositionElaboratorId: 'c2' })

    fireEvent.change(seedField(), { target: { value: '' } })
    expect(update).toHaveBeenCalledWith({ seed: '' })
    expect(seedField().value).toBe('')
  })
})
