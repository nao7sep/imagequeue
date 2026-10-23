// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { installVirtualListLayout } from '../../virtual-list-layout'
import type { ElaboratedPromptRecord } from '../../../../src/shared/types'

// The feature under test: each prompt row shows the concept credits it was
// built from — the one part of the record no amount of reading the prose
// reliably recovers. Legacy entries (normalized from bare strings) have no
// credits and must not render an empty shell.

let prompts: ElaboratedPromptRecord[] = []
const deletePrompt = vi.fn((index: number) => { prompts = prompts.filter((_, i) => i !== index) })
vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    state: { elaboratedPrompts: prompts },
    deleteElaboratedPromptAt: deletePrompt,
    clearElaboratedPrompts: vi.fn(),
  }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async () => true,
}))

const { ElaboratedPromptsModal } = await import(
  '../../../../src/renderer/src/components/ElaboratedPromptsModal'
)

let restoreLayout: () => void
beforeEach(() => { restoreLayout = installVirtualListLayout(); deletePrompt.mockClear() })
afterEach(() => {
  cleanup()
  restoreLayout()
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


it('bounds long histories, reaches every row, and deletes the selected duplicate by its original index', async () => {
  prompts = Array.from({ length: 5000 }, (_, index) => ({ text: `prompt-${index}`, concepts: [] }))
  prompts[0] = { text: 'duplicate', concepts: [] }
  prompts[1] = { text: 'duplicate', concepts: [] }
  const view = render(<ElaboratedPromptsModal onClose={vi.fn()} />)
  const first = screen.getByText('prompt-4999').closest<HTMLElement>('[role="option"]')!
  expect(document.activeElement).toBe(first)
  expect(screen.getAllByRole('option').length).toBeLessThan(20)
  fireEvent.keyDown(first, { key: 'End' })
  const last = document.activeElement as HTMLElement
  expect(last.getAttribute('aria-posinset')).toBe('5000')
  expect(last.textContent).toContain('duplicate')
  fireEvent.keyDown(last, { key: 'Delete' })
  expect(deletePrompt).toHaveBeenCalledExactlyOnceWith(0)
  view.rerender(<ElaboratedPromptsModal onClose={vi.fn()} />)
  expect(document.activeElement?.getAttribute('aria-posinset')).toBe('4999')
  expect(document.activeElement?.textContent).toContain('duplicate')
  expect(document.activeElement?.getAttribute('aria-selected')).toBe('true')
  expect(screen.getAllByRole('option').length).toBeLessThan(20)
  fireEvent.keyDown(document.activeElement!, { key: 'Home' })
  expect(document.activeElement?.textContent).toContain('prompt-4999')
  const viewport = document.querySelector<HTMLElement>('.elaborated-prompts-body')!
  act(() => { viewport.scrollTop = 100000; fireEvent.scroll(viewport) })
  expect(document.activeElement?.textContent).toContain('prompt-4999')
  expect(screen.getAllByRole('option').length).toBeLessThan(20)
})


it('returns focus to the reachable empty history after deleting its last row', () => {
  prompts = [{ text: 'only prompt', concepts: [] }]
  const view = render(<ElaboratedPromptsModal onClose={vi.fn()} />)
  fireEvent.keyDown(document.activeElement!, { key: 'Delete' })
  view.rerender(<ElaboratedPromptsModal onClose={vi.fn()} />)
  const list = screen.getByRole('listbox')
  expect(document.activeElement).toBe(list)
  expect(list.getAttribute('tabindex')).toBe('0')
  expect(screen.queryByRole('option')).toBeNull()
})
