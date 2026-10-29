// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuitQuestion } from '../../../../src/shared/quit'

const { QuitFailureApp } = await import('../../../../src/renderer/src/components/QuitFailureApp')

function ask(question: QuitQuestion): { chooseQuit: ReturnType<typeof vi.fn> } {
  const chooseQuit = vi.fn()
  window.electronAPI = {
    getQuitQuestion: vi.fn(async () => question),
    chooseQuit,
    reportQuitHeight: vi.fn(),
  } as unknown as typeof window.electronAPI
  return { chooseQuit }
}

afterEach(cleanup)

// Quit asks before ending what the user can still see (unsaved-edits-conventions).
describe('quit question page', () => {
  it('names the images, tool work and dialogs quitting would end, and quits only on its own button', async () => {
    const { chooseQuit } = ask({ kind: 'confirm', work: { generating: 2, elaborating: false, tools: true, drafts: ['settings', 'elaborators'] }, platform: 'darwin' })
    render(<QuitFailureApp />)
    await act(async () => {})
    expect(screen.getByText('2 images are still generating and will be stopped.')).toBeTruthy()
    expect(screen.getByText('A Draw Things download, import or check is running and will be stopped.')).toBeTruthy()
    expect(screen.getByText('Unsaved changes in Settings and Elaborators will be discarded.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(document.activeElement?.textContent).toBe('Cancel')
    fireEvent.click(screen.getByRole('button', { name: 'Quit ImageQueue' }))
    expect(chooseQuit).toHaveBeenLastCalledWith('quit')
  })

  it('says only what applies, and uses Exit on Windows', async () => {
    ask({ kind: 'confirm', work: { generating: 1, elaborating: false, tools: false, drafts: [] }, platform: 'win32' })
    render(<QuitFailureApp />)
    await act(async () => {})
    expect(screen.getByText('1 image is still generating and will be stopped.')).toBeTruthy()
    expect(screen.queryByText(/Draw Things/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Exit ImageQueue' })).toBeTruthy()
  })

  it('names elaboration without inventing an image count or tool job', async () => {
    ask({ kind: 'confirm', work: { generating: 0, elaborating: true, tools: false, drafts: [] }, platform: 'darwin' })
    render(<QuitFailureApp />)
    await act(async () => {})
    expect(screen.getByText('Prompt elaboration is running and will be stopped.')).toBeTruthy()
    expect(screen.queryByText(/images? (is|are) still generating/)).toBeNull()
    expect(screen.queryByText(/Draw Things/)).toBeNull()
  })

  it('keeps Retry, Quit anyway and Cancel for a failed save', async () => {
    const { chooseQuit } = ask({ kind: 'saveFailed' })
    render(<QuitFailureApp />)
    await act(async () => {})
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(chooseQuit).toHaveBeenLastCalledWith('cancel')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quit anyway' })).toBeTruthy()
  })

  it('describes a save still running at the deadline as not finished, with the same choices', async () => {
    ask({ kind: 'saveUnfinished' })
    render(<QuitFailureApp />)
    await act(async () => {})
    expect(screen.getByText(/have not finished saving/)).toBeTruthy()
    expect(screen.queryByText(/could not be saved/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Quit anyway' })).toBeTruthy()
  })
})
