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

let facets: ConceptFacetSummary[]
let probes: ConceptProbeSummary[]
let rows: ConceptRow[]
const makeRow = (id: number, probeId: number, display: string, probe: string, useCount = 0): ConceptRow => ({
  id, probeId, display, probe, useCount, lastUsedAt: null, createdAt: '2026-10-01T00:00:00Z',
})

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true)
  facets = [{ id: 1, display: 'place', conceptCount: 3, unusedCount: 2, probeCount: 2, lastUsedAt: null }]
  probes = [
    { id: 10, display: 'ports', expanded: 1, conceptCount: 2, unusedCount: 1 },
    { id: 20, display: 'woods', expanded: 1, conceptCount: 1, unusedCount: 1 },
  ]
  rows = [makeRow(100, 10, 'dock', 'ports'), makeRow(101, 10, 'wharf', 'ports', 1), makeRow(200, 20, 'tree', 'woods')]
  window.electronAPI = {
    listConceptFacets: vi.fn(async () => [...facets]),
    listConceptProbes: vi.fn(async () => [...probes]),
    listConceptRows: vi.fn(async () => [...rows]),
    deleteConceptRow: vi.fn(async (id: number) => { rows = rows.filter((row) => row.id !== id) }),
    deleteConceptProbe: vi.fn(async (id: number) => {
      probes = probes.filter((probe) => probe.id !== id)
      rows = rows.filter((row) => row.probeId !== id)
    }),
    deleteConceptFacet: vi.fn(async () => undefined),
    appLog: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
})

afterEach(cleanup)

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
    expect(document.activeElement).toBe(options[1])
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
    expect(within(list).queryByText('dock')).toBeNull()
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
