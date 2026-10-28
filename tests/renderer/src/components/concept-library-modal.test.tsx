// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConceptFacetSummary, ConceptProbeSummary, ConceptRow } from '../../../../src/shared/types'

const confirm = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({ useConfirm: () => confirm }))
import { ConceptLibraryModal } from '../../../../src/renderer/src/components/ConceptLibraryModal'

// jsdom omits the CSSOM escape used by the real listbox focus lookup.
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  ;(globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
    escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => '\\' + character),
  }
}

// Give the real virtualizer the layout information a browser supplies.
class LibraryResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() => this.callback([{ target, contentRect: target.getBoundingClientRect(),
      borderBoxSize: [{ inlineSize: 640, blockSize: (target as HTMLElement).offsetHeight }],
    } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver))
  }
  disconnect(): void {}
  unobserve(): void {}
}
function elementHeight(element: HTMLElement): number {
  if (element.classList.contains('concept-library-virtual')) return 400
  if (element.classList.contains('concept-library-block')) {
    const count = element.querySelectorAll('.concept-library-row').length
    if (!element.querySelector('.concept-library-page')) return Number.parseFloat(element.firstElementChild?.getAttribute('style')?.match(/height: ([\d.]+)/)?.[1] ?? '768')
    return Math.ceil(count / 2) * 48 + (element.querySelector('.concept-library-section-header') ? 56 : 0) + (element.classList.contains('last') ? 12 : 0)
  }
  return 48
}

let facets: ConceptFacetSummary[]
let probes: ConceptProbeSummary[]
let rows: ConceptRow[]
const makeRow = (id: number, probeId: number, display: string, probe: string, useCount = 0): ConceptRow => ({
  id, probeId, display, probe, useCount, lastUsedAt: null, createdAt: '2026-10-01T00:00:00Z',
})

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true)
  vi.stubGlobal('ResizeObserver', LibraryResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return elementHeight(this) })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return elementHeight(this) })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: 640, height: elementHeight(this), top: 0, left: 0, right: 640, bottom: elementHeight(this), x: 0, y: 0, toJSON: () => ({}) }
  })
  HTMLElement.prototype.scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object') this.scrollTop = options.top ?? this.scrollTop
    this.dispatchEvent(new Event('scroll'))
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  facets = [{ id: 1, display: 'place', conceptCount: 3, unusedCount: 2, probeCount: 2, lastUsedAt: null }]
  probes = [
    { id: 10, display: 'ports', expanded: 1, conceptCount: 2, unusedCount: 1 },
    { id: 20, display: 'woods', expanded: 1, conceptCount: 1, unusedCount: 1 },
  ]
  rows = [makeRow(100, 10, 'dock', 'ports', 1), makeRow(101, 10, 'wharf', 'ports'), makeRow(200, 20, 'tree', 'woods')]
  window.electronAPI = {
    listConceptFacets: vi.fn(async () => [...facets]),
    listConceptProbes: vi.fn(async () => [...probes]),
    // The ledger orders a facet's concepts by use, then by name.
    listConceptRows: vi.fn(async () => [...rows].sort((x, y) => y.useCount - x.useCount || (x.display < y.display ? -1 : x.display > y.display ? 1 : 0))),
    deleteConceptRow: vi.fn(async (id: number) => { rows = rows.filter((row) => row.id !== id) }),
    deleteConceptProbe: vi.fn(async (id: number) => {
      probes = probes.filter((probe) => probe.id !== id)
      rows = rows.filter((row) => row.probeId !== id)
    }),
    deleteConceptFacet: vi.fn(async () => undefined),
    appLog: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function mountDetails(): Promise<HTMLElement> {
  render(<ConceptLibraryModal onClose={vi.fn()} />)
  const list = await screen.findByRole('listbox', { name: 'place' })
  await within(list).findByText('dock')
  return list
}

function openMenu(row: HTMLElement, shift = false): void {
  act(() => row.focus())
  fireEvent.keyDown(row, shift ? { key: 'F10', shiftKey: true } : { key: 'ContextMenu' })
}

async function menuDelete(): Promise<void> {
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })) })
}

describe('concept library detail actions', () => {
  it('navigates domain then concepts in displayed order through one Tab stop', async () => {
    const list = await mountDetails()
    const options = within(list).getAllByRole('option')
    expect(options.map((option) => option.dataset.listboxOption)).toEqual(['p:10', 'c:100', 'c:101', 'p:20', 'c:200'])
    expect(list.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    act(() => options[0].focus())
    fireEvent.keyDown(options[0], { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(options[1]))
    expect(options[1].getAttribute('aria-selected')).toBe('true')
    expect(options[1].classList.contains('selected')).toBe(true)
    expect(list.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    expect(list.contains(trigger)).toBe(false)
    expect(within(list).getAllByRole('button').every((button) => button.tabIndex === -1)).toBe(true)
    expect(window.electronAPI.deleteConceptRow).not.toHaveBeenCalled()
  })

  it.each([false, true])('confirms and deletes the keyboard active concept using the menu (Shift+F10 %s)', async (shift) => {
    const list = await mountDetails()
    const options = within(list).getAllByRole('option')
    act(() => options[0].focus())
    fireEvent.keyDown(options[0], { key: 'ArrowDown' })
    openMenu(options[1], shift)
    await menuDelete()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Concept', message: expect.stringContaining('dock'), danger: true }))
    expect(window.electronAPI.deleteConceptRow).toHaveBeenCalledExactlyOnceWith(100)
    expect(window.electronAPI.deleteConceptProbe).not.toHaveBeenCalled()
    await waitFor(() => expect(within(list).queryByText('dock')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }))
    await within(list).findByText('wharf')
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    await menuDelete()
    expect(window.electronAPI.deleteConceptProbe).toHaveBeenCalledExactlyOnceWith(10)
    expect(window.electronAPI.deleteConceptRow).toHaveBeenCalledTimes(1)
  })

  it('targets a surviving visible domain after filtering out the active concept', async () => {
    const list = await mountDetails()
    const dock = within(list).getByText('dock').closest<HTMLElement>('[role="option"]')!
    fireEvent.click(dock)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tree' } })
    await waitFor(() => expect(within(list).queryByText('dock')).toBeNull())
    await within(list).findByText('tree')
    expect(within(list).getAllByRole('option').map((option) => option.dataset.listboxOption)).toEqual(['p:20', 'c:200'])
    expect(list.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    await menuDelete()
    expect(window.electronAPI.deleteConceptProbe).toHaveBeenCalledExactlyOnceWith(20)
    expect(window.electronAPI.deleteConceptRow).not.toHaveBeenCalled()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Actions' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('retains the pointer delete buttons and honors cancelled confirmation', async () => {
    const list = await mountDetails()
    const dock = within(list).getByText('dock').closest<HTMLElement>('[role="option"]')!
    confirm.mockResolvedValueOnce(false)
    await act(async () => { fireEvent.click(within(dock).getByRole('button', { name: 'Delete' })) })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Concept' }))
    expect(window.electronAPI.deleteConceptRow).not.toHaveBeenCalled()
    const domain = within(list).getByText('ports').closest<HTMLElement>('[role="option"]')!
    await act(async () => { fireEvent.click(within(domain).getByRole('button', { name: 'Delete' })) })
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Delete Domain' }))
    expect(window.electronAPI.deleteConceptProbe).toHaveBeenCalledWith(10)
  })

  it('disables Actions while details are loading, failed, or filtered empty', async () => {
    let reject!: (error: Error) => void
    vi.mocked(window.electronAPI.listConceptRows).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    render(<ConceptLibraryModal onClose={vi.fn()} />)
    const trigger = await screen.findByRole('button', { name: 'Actions' }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    await act(async () => reject(new Error('unreadable details')))
    expect(trigger.disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t load this facet')
  })

  it('clears detail selection when changing facets', async () => {
    facets.push({ ...facets[0], id: 2, display: 'occupation' })
    const list = await mountDetails()
    fireEvent.click(within(list).getByText('dock').closest('[role="option"]')!)
    fireEvent.click(screen.getByRole('option', { name: /occupation/ }))
    const next = await screen.findByRole('listbox', { name: 'occupation' })
    await within(next).findByText('dock')
    expect(within(next).getAllByRole('option').every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    await menuDelete()
    expect(window.electronAPI.deleteConceptProbe).toHaveBeenCalledWith(10)
    expect(window.electronAPI.deleteConceptRow).not.toHaveBeenCalled()
  })
})


describe('large concept library', () => {
  function largeFacet(): void {
    probes = [{ id: 10, display: 'ports', expanded: 1, conceptCount: 3201, unusedCount: 3201 }]
    rows = Array.from({ length: 3200 }, (_, i) => makeRow(10000 + i, 10, `dock ${String(i).padStart(4, '0')}`, 'ports'))
    rows.push(makeRow(50000, 10, 'zebra destination', 'ports'))
    facets = [{ ...facets[0], conceptCount: rows.length, unusedCount: rows.length, probeCount: 1 }]
  }
  async function mountLarge(): Promise<HTMLElement> {
    largeFacet()
    render(<ConceptLibraryModal onClose={vi.fn()} />)
    const list = await screen.findByRole('listbox', { name: 'place' })
    await within(list).findByText('dock 0000')
    return list
  }
  function option(list: HTMLElement, key: string): HTMLElement | null {
    return list.querySelector(`[data-listbox-option="${key}"]`)
  }
  async function key(list: HTMLElement, value: string, expected: string): Promise<HTMLElement> {
    fireEvent.keyDown(list, { key: value })
    await waitFor(() => expect(document.activeElement).toBe(option(list, expected)))
    const target = option(list, expected)!
    expect(target.getAttribute('aria-selected')).toBe('true')
    return target
  }

  it('bounds mounted chips while navigating the complete facet across block boundaries', async () => {
    const list = await mountLarge()
    expect(list.querySelectorAll('.concept-library-row').length).toBeLessThan(150)
    act(() => option(list, 'p:10')!.focus())
    await key(list, 'End', 'c:50000')
    expect(document.activeElement?.textContent).toContain('zebra destination')
    expect(list.querySelectorAll('.concept-library-row').length).toBeLessThan(150)
    await key(list, 'Home', 'p:10')
    act(() => { for (let i = 0; i < 32; i++) fireEvent.keyDown(list, { key: 'ArrowDown' }) })
    await waitFor(() => expect(document.activeElement).toBe(option(list, 'c:10031')))
    await key(list, 'ArrowDown', 'c:10032')
    await key(list, 'ArrowUp', 'c:10031')
    expect(list.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  })

  it('typeahead finds an unmounted item and Actions uses its identity', async () => {
    const list = await mountLarge()
    expect(within(list).queryByText('zebra destination')).toBeNull()
    act(() => option(list, 'p:10')!.focus())
    await key(list, 'z', 'c:50000')
    openMenu(document.activeElement as HTMLElement)
    await menuDelete()
    expect(window.electronAPI.deleteConceptRow).toHaveBeenCalledExactlyOnceWith(50000)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('zebra destination') }))
    await waitFor(() => expect(within(list).queryByText('zebra destination')).toBeNull())
  })
})
