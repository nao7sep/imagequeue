// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ElaboratedPromptRecord } from '../../../../src/shared/types'

// The feature under test: each prompt row shows the concept credits it was
// built from — the one part of the record no amount of reading the prose
// reliably recovers. Legacy entries (normalized from bare strings) have no
// credits and must not render an empty shell.

const prompts: ElaboratedPromptRecord[] = []
vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    state: { elaboratedPrompts: prompts },
    deleteElaboratedPromptAt: vi.fn(),
    clearElaboratedPrompts: vi.fn(),
  }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async () => true,
}))

const { ElaboratedPromptsModal } = await import(
  '../../../../src/renderer/src/components/ElaboratedPromptsModal'
)

afterEach(() => {
  cleanup()
  prompts.length = 0
})

describe('ElaboratedPromptsModal concept credits', () => {
  it('shows each credited prompt with its facet: concept pairs', () => {
    prompts.push({
      text: 'a pearl diver on a cargo quay',
      concepts: [
        { facet: 'occupation', concept: 'pearl diver' },
        { facet: 'place', concept: 'cargo quay' },
      ],
    })
    render(<ElaboratedPromptsModal onClose={() => {}} />)
    const line = document.querySelector('.elaborated-prompts-concepts')
    expect(line).not.toBeNull()
    expect(line!.textContent).toContain('occupation:')
    expect(line!.textContent).toContain('pearl diver')
    expect(line!.textContent).toContain('place:')
    expect(line!.textContent).toContain('cargo quay')
  })

  // The modal's reason to exist is the FULL record: a 200-grapheme preview here
  // (the budget the dense queue rows rightly use) would truncate the very thing
  // the user opened it to read.
  it('shows a long prompt whole, not a preview of it', () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ')
    prompts.push({ text: long, concepts: [] })
    render(<ElaboratedPromptsModal onClose={() => {}} />)
    const text = document.querySelector('.elaborated-prompts-text')
    expect(text!.textContent).toBe(long)
  })

  it('renders no credits line for a legacy prompt without them', () => {
    prompts.push({ text: 'an old prompt from before credits', concepts: [] })
    render(<ElaboratedPromptsModal onClose={() => {}} />)
    expect(screen.getByText('an old prompt from before credits')).toBeTruthy()
    expect(document.querySelector('.elaborated-prompts-concepts')).toBeNull()
  })
})
