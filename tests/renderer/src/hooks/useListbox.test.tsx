// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { useListbox, type ListboxItems } from '../../../../src/renderer/src/hooks/useListbox'

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
  it('keeps the listbox itself reachable when there are no options', () => {
    const onSelect = vi.fn()
    const { container, rerender } = render(<Harness ids={[]} onSelect={onSelect} />)
    const list = container.querySelector<HTMLElement>('[role="listbox"]')!

    expect(list.tabIndex).toBe(0)
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(0)

    rerender(<Harness ids={PROMPT_IDS} onSelect={onSelect} />)
    expect(list.tabIndex).toBe(-1)
    expect(list.querySelector<HTMLElement>('[role="option"]')?.tabIndex).toBe(0)

    rerender(<Harness ids={[]} onSelect={onSelect} />)
    expect(list.tabIndex).toBe(0)
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(0)
  })

  it('arrow-navigates and moves DOM focus between rows', () => {
    const { container } = render(<Harness ids={PROMPT_IDS} onSelect={vi.fn()} />)
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-listbox-option]'))
    act(() => rows[0].focus())
    expect(document.activeElement).toBe(rows[0])

    const list = container.querySelector('[role="listbox"]')!
    expect((list as HTMLElement).tabIndex).toBe(-1)
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

  // composite-control-conventions: the pointer marks a row without moving the
  // keyboard target, so Enter and the next arrow act on what the keys reached.
  it('keeps the keyboard target when the pointer hovers an earlier row', () => {
    const onSelect = vi.fn()
    const { container } = render(<Harness ids={PROMPT_IDS} onSelect={onSelect} />)
    const list = container.querySelector('[role="listbox"]')!
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-listbox-option]'))
    act(() => rows[0].focus())
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[2])

    fireEvent.pointerMove(rows[0])
    fireEvent.mouseEnter(rows[0])
    onSelect.mockClear()
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PROMPT_IDS[2])
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[1])
  })

  it('keeps the highlighted row through a live reorder', () => {
    const onSelect = vi.fn()
    const { container, rerender } = render(<Harness ids={PROMPT_IDS} onSelect={onSelect} />)
    const list = container.querySelector('[role="listbox"]')!
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-listbox-option]'))
    act(() => rows[0].focus())
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])

    rerender(<Harness ids={['3 a newer prompt', ...[...PROMPT_IDS].reverse()]} onSelect={onSelect} />)
    expect(document.activeElement?.getAttribute('data-listbox-option')).toBe(PROMPT_IDS[1])
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0')
    onSelect.mockClear()
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PROMPT_IDS[1])
  })
})


function IndexedHarness({ items, onNavigate, onSelect = () => {}, activation = 'follows-focus', onPrimary }: {
  items: ListboxItems
  onNavigate: (id: string) => void
  onSelect?: (id: string) => void
  activation?: 'follows-focus' | 'manual'
  onPrimary?: (id: string) => void
}): React.JSX.Element {
  const { activeId, listboxProps, getOptionProps } = useListbox({
    items, onNavigate, onSelect, selectedId: null, activation, onPrimary,
  })
  return <><div {...listboxProps} data-active={activeId}>
    <div {...getOptionProps('item-0')}>First mounted page</div>
  </div><input aria-label="Outside list" /></>
}

function indexedItems(): ListboxItems {
  return {
    count: 100000,
    idAt: vi.fn((index: number) => `item-${index}`),
    indexOf: (id: string) => {
      const match = /^item-(\d+)$/.exec(id)
      return match && Number(match[1]) < 100000 ? Number(match[1]) : -1
    },
  }
}

function deferredIndex(): { promise: Promise<number>; resolve: (index: number) => void } {
  let resolve!: (index: number) => void
  const promise = new Promise<number>((done) => { resolve = done })
  return { promise, resolve }
}

function focusIndexed(container: HTMLElement): HTMLElement {
  const option = container.querySelector<HTMLElement>('[role="option"]')!
  act(() => option.focus())
  return container.querySelector<HTMLElement>('[role="listbox"]')!
}

describe('indexed listbox collections', () => {
  it('navigates the full collection without enumerating ids or waiting for DOM focus', () => {
    const items = indexedItems()
    const onNavigate = vi.fn()
    const onSelect = vi.fn()
    const { container } = render(<IndexedHarness items={items} onNavigate={onNavigate} onSelect={onSelect} />)
    const list = focusIndexed(container)
    vi.mocked(items.idAt).mockClear()
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'End' })
    fireEvent.keyDown(list, { key: 'PageUp' })
    fireEvent.keyDown(list, { key: 'Home' })
    expect(onNavigate.mock.calls.map(([id]) => id)).toEqual(['item-1', 'item-2', 'item-99999', 'item-99991', 'item-0'])
    expect(onSelect.mock.calls).toEqual(onNavigate.mock.calls)
    expect(vi.mocked(items.idAt).mock.calls.map(([index]) => index)).toEqual([1, 2, 99999, 99991, 0])
    expect(document.activeElement).toBe(list.querySelector('[role="option"]'))
  })

  it('keeps manual navigation separate from primary activation while mounting is pending', () => {
    const onNavigate = vi.fn()
    const onSelect = vi.fn()
    const onPrimary = vi.fn()
    const { container } = render(<IndexedHarness items={indexedItems()} onNavigate={onNavigate} onSelect={onSelect} onPrimary={onPrimary} activation="manual" />)
    const list = focusIndexed(container)
    fireEvent.keyDown(list, { key: 'End' })
    expect(onNavigate).toHaveBeenCalledWith('item-99999')
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onPrimary).toHaveBeenCalledExactlyOnceWith('item-99999')
  })

  it('uses asynchronous full-collection prefix search without walking unloaded ids', async () => {
    const result = deferredIndex()
    const items = { ...indexedItems(), findPrefix: vi.fn(() => result.promise) }
    const onNavigate = vi.fn()
    const onSelect = vi.fn()
    const { container } = render(<IndexedHarness items={items} onNavigate={onNavigate} onSelect={onSelect} />)
    const list = focusIndexed(container)
    vi.mocked(items.idAt).mockClear()
    fireEvent.keyDown(list, { key: 'z' })
    expect(items.findPrefix).toHaveBeenCalledExactlyOnceWith('z', 0)
    expect(onNavigate).not.toHaveBeenCalled()
    await act(async () => result.resolve(87654))
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('item-87654')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('item-87654')
    expect(items.idAt).toHaveBeenCalledExactlyOnceWith(87654)
  })

  it('applies only the latest typeahead result and ignores no match', async () => {
    const first = deferredIndex()
    const second = deferredIndex()
    const third = deferredIndex()
    const items = { ...indexedItems(), findPrefix: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise) }
    const onNavigate = vi.fn()
    const { container } = render(<IndexedHarness items={items} onNavigate={onNavigate} />)
    const list = focusIndexed(container)
    fireEvent.keyDown(list, { key: 'z' })
    fireEvent.keyDown(list, { key: 'e' })
    await act(async () => first.resolve(50))
    expect(onNavigate).not.toHaveBeenCalled()
    await act(async () => second.resolve(90))
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('item-90')
    fireEvent.keyDown(list, { key: 'r' })
    await act(async () => third.resolve(-1))
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it.each(['navigation', 'blur', 'model', 'unmount'] as const)('invalidates an outstanding search on %s', async (action) => {
    const result = deferredIndex()
    const items = { ...indexedItems(), findPrefix: vi.fn(() => result.promise) }
    const onNavigate = vi.fn()
    const view = render(<IndexedHarness items={items} onNavigate={onNavigate} />)
    const list = focusIndexed(view.container)
    fireEvent.keyDown(list, { key: 'z' })
    if (action === 'navigation') fireEvent.keyDown(list, { key: 'End' })
    if (action === 'blur') {
      act(() => view.container.querySelector('input')!.focus())
      // Returning before the request finishes still must not revive the search.
      act(() => list.querySelector<HTMLElement>('[role="option"]')!.focus())
    }
    if (action === 'model') view.rerender(<IndexedHarness items={{ ...items }} onNavigate={onNavigate} />)
    if (action === 'unmount') view.unmount()
    onNavigate.mockClear()
    await act(async () => result.resolve(500))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('uses the current navigation handler when a pending search resolves', async () => {
    const result = deferredIndex()
    const items = { ...indexedItems(), findPrefix: () => result.promise }
    const original = vi.fn()
    const latest = vi.fn()
    const view = render(<IndexedHarness items={items} onNavigate={original} />)
    const list = focusIndexed(view.container)
    fireEvent.keyDown(list, { key: 'z' })
    view.rerender(<IndexedHarness items={items} onNavigate={latest} />)
    await act(async () => result.resolve(500))
    expect(original).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledExactlyOnceWith('item-500')
  })

  it('accepts synchronous indexed prefix search', () => {
    const items = { ...indexedItems(), findPrefix: vi.fn(() => 700) }
    const onNavigate = vi.fn()
    const { container } = render(<IndexedHarness items={items} onNavigate={onNavigate} />)
    const list = focusIndexed(container)
    fireEvent.keyDown(list, { key: 's' })
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('item-700')
  })

  it('preserves synchronous visible-label typeahead for array consumers', () => {
    const ids = ['Alpha', 'Beta', 'Zebra']
    const onSelect = vi.fn()
    const { container } = render(<Harness ids={ids} onSelect={onSelect} />)
    const list = container.querySelector<HTMLElement>('[role="listbox"]')!
    act(() => list.querySelector<HTMLElement>('[role="option"]')!.focus())
    fireEvent.keyDown(list, { key: 'z' })
    expect(document.activeElement?.textContent).toBe('Zebra')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Zebra')
  })
})
