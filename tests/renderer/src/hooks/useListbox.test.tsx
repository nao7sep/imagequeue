// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { useListbox } from '../../../../src/renderer/src/hooks/useListbox'

// jsdom omits CSS.escape (a CSSOM API the real Electron/Chromium renderer has,
// which is why the live app's listboxes work). Polyfill it so the hook's
// id-based focusOption querySelector runs here too: backslash-escape any
// non-identifier char, which is a valid CSS escape inside a quoted attribute
// selector and matches the literal attribute value.
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  ;(globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS = {
    escape: (value: string): string =>
      String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch),
  }
}

afterEach(cleanup)

// A minimal consumer of the shared listbox hook, with a real selection model
// (follows-focus), so click-to-select and arrow navigation are exercised against
// a real DOM — including ids that contain spaces and punctuation, the shape the
// elaborated-prompts list uses (text-derived ids), which the hook locates with a
// CSS.escape'd querySelector.
function Harness({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const { listboxProps, getOptionProps } = useListbox<HTMLUListElement>({
    ids,
    selectedId: selected,
    onSelect: (id) => {
      setSelected(id)
      onSelect(id)
    },
    activation: 'follows-focus',
  })
  return (
    <ul {...listboxProps}>
      {ids.map((id) => (
        <li key={id} {...getOptionProps(id)}>
          {id}
        </li>
      ))}
    </ul>
  )
}

const PROMPT_IDS = [
  '0 A serene mountain landscape, at dawn.',
  '1 A neon city "skyline" at night.',
  '2 third prompt',
]

describe('useListbox with prompt-style ids (spaces + punctuation)', () => {
  it('arrow-navigates and moves DOM focus between rows', () => {
    const { container } = render(<Harness ids={PROMPT_IDS} onSelect={vi.fn()} />)
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-listbox-option]'))
    act(() => rows[0].focus())
    expect(document.activeElement).toBe(rows[0])

    const list = container.querySelector('[role="listbox"]')!
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[2])
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[1])
  })

  it('click selects the row and marks it aria-selected (follows-focus commits)', () => {
    const onSelect = vi.fn()
    const { container } = render(<Harness ids={PROMPT_IDS} onSelect={onSelect} />)
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-listbox-option]'))
    fireEvent.click(rows[2])
    expect(onSelect).toHaveBeenCalledWith(PROMPT_IDS[2])
    expect(rows[2].getAttribute('aria-selected')).toBe('true')
  })
})
