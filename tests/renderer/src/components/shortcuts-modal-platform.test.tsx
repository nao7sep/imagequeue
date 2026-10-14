// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ShortcutsModal } from '../../../../src/renderer/src/components/ShortcutsModal'

// The shortcut reference names the modifier the user actually presses: Cmd on
// macOS, Ctrl elsewhere. A list that showed the wrong one would teach chords
// that do nothing.

vi.mock('../../../../src/renderer/src/hooks/useVisiblePanes', () => ({
  useVisiblePanes: () => ({ panes: ['openai', 'grok'], backends: ['openai', 'grok'] }),
}))

afterEach(cleanup)

function shownKeys(platform: string): string[] {
  Object.assign(window, { electronAPI: { platform } })
  render(<ShortcutsModal onClose={() => {}} />)
  return Array.from(document.querySelectorAll('kbd')).map((key) => key.textContent ?? '')
}

describe('shortcut reference modifier', () => {
  it('names Cmd on macOS and never Ctrl', () => {
    const keys = shownKeys('darwin')
    expect(keys).toEqual(expect.arrayContaining(['Cmd+P', 'Cmd+Enter', 'Cmd+1', 'Cmd+2', 'Delete / Cmd+Backspace', 'Cmd+Comma', 'Cmd+Slash', 'Cmd+Shift+K']))
    expect(keys.filter((key) => key.includes('Ctrl'))).toEqual([])
  })

  it('names Ctrl on Windows and never Cmd', () => {
    const keys = shownKeys('win32')
    expect(keys).toEqual(expect.arrayContaining(['Ctrl+P', 'Ctrl+Enter', 'Ctrl+1', 'Ctrl+2', 'Delete / Ctrl+Backspace', 'Ctrl+Comma', 'Ctrl+Slash', 'Ctrl+Shift+K']))
    expect(keys.filter((key) => key.includes('Cmd'))).toEqual([])
  })
})
