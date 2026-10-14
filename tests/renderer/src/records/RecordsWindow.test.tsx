// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordsApp, RecordsWindow } from '../../../../src/renderer/src/records/RecordsWindow'
import type { ElectronAPI } from '../../../../src/shared/electron-api'
import { RECORDS_LIST_WIDTH, RECORDS_WINDOW_MIN_WIDTH } from '../../../../src/shared/records-layout'
import type { RecordDetail, RecordsPage, RecordsQuery, RecordSummary } from '../../../../src/shared/records'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom omits CSS.escape, which the listbox layer uses to find a row.
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  ;(globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS = {
    escape: (value: string): string => String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch),
  }
}

const LAUNCH = '2026-10-02T08:00:00.000Z'
const SESSION = '20261002-080000-000-utc'

const call: RecordSummary = {
  kind: 'ai-call', id: 4, time: '2026-10-02T08:01:00.000Z', level: 'error', title: 'gemini brainstorm', text: 'gemini-x',
}
const line: RecordSummary = {
  kind: 'log', id: 9, time: '2026-10-02T08:00:30.000Z', level: 'warn', title: 'Generation failed', text: null,
}
const callDetail: RecordDetail = {
  kind: 'ai-call', id: 4, time: '2026-10-02T08:01:00.000Z', launch: LAUNCH, sessionId: SESSION, taskId: null,
  requestId: 'req-1', backend: 'gemini', model: 'gemini-x', purpose: 'brainstorm', durationMs: 2500,
  request: JSON.stringify({ contents: 'say hello', apiKey: 'sk-test' }), response: null,
  error: JSON.stringify({ name: 'Error', message: 'quota' }),
}
const lineDetail: RecordDetail = {
  kind: 'log', id: 9, time: '2026-10-02T08:00:30.000Z', launch: LAUNCH, sessionId: SESSION, taskId: 'task-7',
  requestId: null, level: 'warn', message: 'Generation failed', fields: JSON.stringify({ backend: 'flux', status: 429 }),
}
const job: RecordSummary = {
  kind: 'cli-job', id: 2, time: '2026-10-02T08:00:10.000Z', level: 'warn', title: 'draw-things-cli download', text: 'flux.ckpt',
}
const jobDetail: RecordDetail = {
  kind: 'cli-job', id: 2, time: '2026-10-02T08:00:10.000Z', launch: LAUNCH, sessionId: SESSION, level: 'warn',
  title: 'draw-things-cli download', jobId: 'job-abc', jobKind: 'download', target: 'flux.ckpt',
  cliPath: '/Users/someone/.imagequeue/bin/draw-things-cli', args: JSON.stringify(['models', 'ensure', '--model', 'flux.ckpt']),
  startedAt: '2026-10-02T08:00:10.000Z', endedAt: '2026-10-02T08:00:14.500Z', status: 'killed', exitCode: null,
  signal: 'SIGTERM', stdout: 'Downloading 10%\rDownloading 40%\r', stderr: '\n', error: null,
}
const newer: RecordSummary = {
  kind: 'log', id: 12, time: '2026-10-02T08:02:00.000Z', level: 'info', title: 'Arrived while open', text: null,
}

let root: Root | null = null
const readRecordsPage = vi.fn<ElectronAPI['readRecordsPage']>()
const readRecordDetail = vi.fn<ElectronAPI['readRecordDetail']>()
const readRecordSources = vi.fn<ElectronAPI['readRecordSources']>()
const appLog = vi.fn<ElectronAPI['appLog']>()
const updateUiState = vi.fn<ElectronAPI['updateUiState']>()
const getUiState = vi.fn<ElectronAPI['getUiState']>()
let recordsChanged: (() => void) | null = null
const onRecordsChanged = vi.fn<ElectronAPI['onRecordsChanged']>((listener) => {
  recordsChanged = listener
  return () => {
    recordsChanged = null
  }
})

// jsdom lays nothing out, so the list's scroll box and the shell's width are
// set here. By default the list is scrolled to the top and far from its end.
const box = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 }
const resizeCallbacks = new Set<() => void>()
class TestResizeObserver {
  private readonly callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
  }
  observe(): void {
    resizeCallbacks.add(this.callback)
  }
  disconnect(): void {
    resizeCallbacks.delete(this.callback)
  }
}
const isScroll = (element: HTMLElement) => element.classList.contains('records-list-scroll')

beforeEach(() => {
  readRecordsPage.mockReset()
  readRecordsPage.mockResolvedValue({ records: [call, line], more: false } satisfies RecordsPage)
  readRecordDetail.mockReset()
  readRecordDetail.mockImplementation(async (kind) => (kind === 'log' ? lineDetail : callDetail))
  readRecordSources.mockReset()
  readRecordSources.mockResolvedValue({
    currentLaunch: LAUNCH, currentSession: SESSION, launches: [LAUNCH, '2026-10-01T08:00:00.000Z'], sessions: [SESSION, '20261001-080000-000-utc'],
  })
  appLog.mockReset()
  appLog.mockResolvedValue()
  updateUiState.mockReset()
  updateUiState.mockImplementation(async (patch) => ({ columnWidth: null, notificationVolume: 0.7, recordsListWidth: RECORDS_LIST_WIDTH.default, ...patch }))
  getUiState.mockReset()
  onRecordsChanged.mockClear()
  recordsChanged = null
  Object.assign(box, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 })
  resizeCallbacks.clear()
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return isScroll(this) ? box.scrollTop : 0 },
      set(this: HTMLElement, value: number) { if (isScroll(this)) box.scrollTop = value },
    },
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isScroll(this) ? box.scrollHeight : 0 } },
    clientHeight: { configurable: true, get(this: HTMLElement) { return isScroll(this) ? box.clientHeight : 0 } },
    clientWidth: {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('records-shell') ? box.shellWidth : 0 },
    },
  })
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      readRecordsPage, readRecordDetail, readRecordSources, appLog, updateUiState, getUiState, onRecordsChanged,
    } satisfies Partial<ElectronAPI>,
  })
})

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const name of ['scrollTop', 'scrollHeight', 'clientHeight', 'clientWidth']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
  }
})

async function mount(element: React.ReactElement = React.createElement(RecordsWindow, { initialListWidth: RECORDS_LIST_WIDTH.default })): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
const titles = () => options().map((option) => option.querySelector('.records-row-title')?.textContent)
const lastQuery = (): RecordsQuery => readRecordsPage.mock.calls.at(-1)![0]
const scrollBox = () => document.querySelector<HTMLElement>('.records-list-scroll')!
const shell = () => document.querySelector<HTMLElement>('.records-shell')!
const scrollTo = async (top: number, events = 1) => {
  await act(async () => {
    box.scrollTop = top
    for (let index = 0; index < events; index++) scrollBox().dispatchEvent(new Event('scroll'))
  })
}
const press = async (key: string) => {
  await act(async () => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}
const signal = async () => {
  await act(async () => recordsChanged!())
}
const cursorOf = (record: RecordSummary) => ({ time: record.time, kind: record.kind, id: record.id })
const NO_FILTERS = { launch: null, session: null, kind: null, level: null, search: '', after: null }

describe('RecordsWindow', () => {
  it('lists the records newest first, with nothing selected yet, as one listbox with one tab stop', async () => {
    await mount()

    expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
    expect(lastQuery()).toEqual(NO_FILTERS)
    expect(document.body.textContent).toContain('Select a record to see everything it holds.')
    expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Records')
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1])
    expect(document.title).toBe('Records')
  })

  it('shows everything a selected AI call holds', async () => {
    await mount()
    await act(async () => options()[0]!.click())

    expect(readRecordDetail).toHaveBeenCalledWith('ai-call', 4)
    const blocks = Array.from(document.querySelectorAll('.records-block')).map((block) => [
      block.querySelector('h3')?.textContent,
      block.querySelector('pre')?.textContent,
    ])
    expect(blocks).toEqual([
      ['Request', JSON.stringify({ contents: 'say hello', apiKey: 'sk-test' }, null, 2)],
      ['Error', JSON.stringify({ name: 'Error', message: 'quota' }, null, 2)],
    ])
    const body = document.querySelector('.records-detail-body')!.textContent!
    for (const text of ['gemini-x', 'brainstorm', 'req-1', '2.5', '20261002-080000 (current session)', '(this launch)']) {
      expect(body).toContain(text)
    }
    expect(document.querySelector('.records-detail-title')?.textContent).toBe('gemini brainstorm')
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it("shows a log line's message and every field it stored", async () => {
    await mount()
    await act(async () => options()[1]!.click())

    expect(document.querySelector('.records-detail-title')?.textContent).toBe('Generation failed')
    expect(document.querySelector('.records-block pre')?.textContent).toBe(JSON.stringify({ backend: 'flux', status: 429 }, null, 2))
    expect(document.querySelector('.records-detail-body')!.textContent).toContain('task-7')
  })

  it('leaves out a block with nothing in it, keeping the fields', async () => {
    readRecordDetail.mockImplementation(async (kind) => (kind === 'log'
      ? { ...lineDetail, fields: '{}' }
      : { ...callDetail, request: '{}', response: '  ', error: 'null' }))
    await mount()
    const blockLabels = () => Array.from(document.querySelectorAll('.records-block h3')).map((label) => label.textContent)

    await act(async () => options()[1]!.click())
    expect(document.querySelector('.records-detail-title')?.textContent).toBe('Generation failed')
    expect(blockLabels()).toEqual([])
    expect(document.querySelector('.records-detail-body')!.textContent).toContain('task-7')

    await act(async () => options()[0]!.click())
    expect(document.querySelector('.records-detail-title')?.textContent).toBe('gemini brainstorm')
    expect(blockLabels()).toEqual([])
    expect(document.querySelector('.records-detail-body')!.textContent).toContain('gemini-x')
  })

  it('shows everything a selected CLI job holds, its output as the terminal left it', async () => {
    readRecordsPage.mockResolvedValue({ records: [job], more: false })
    readRecordDetail.mockResolvedValue(jobDetail)
    await mount()
    const row = options()[0]!
    expect(row.querySelector('.records-pill:not(.records-pill--warn)')?.textContent).toBe('CLI job')
    expect(row.querySelector('.records-row-title')?.textContent).toBe('draw-things-cli download')
    expect(row.querySelector('.records-row-text')?.textContent).toBe('flux.ckpt')

    await act(async () => row.click())

    expect(readRecordDetail).toHaveBeenCalledWith('cli-job', 2)
    expect(document.querySelector('.records-detail-title')?.textContent).toBe('draw-things-cli download')
    const fields = Object.fromEntries(Array.from(document.querySelectorAll('.records-meta > div')).map((field) => [
      field.querySelector('dt')?.textContent, field.querySelector('dd')?.textContent,
    ]))
    expect(fields).toMatchObject({
      Target: 'flux.ckpt', Command: '/Users/someone/.imagequeue/bin/draw-things-cli', Status: 'Stopped', Signal: 'SIGTERM',
      Job: 'job-abc', Session: '20261002-080000 (current session)',
    })
    expect(fields['Duration']).toContain('4.5')
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(['Requested', 'Started', 'Finished']))
    expect(Object.keys(fields)).not.toContain('Exit code')
    expect(Object.keys(fields)).not.toContain('Task')
    const blocks = Array.from(document.querySelectorAll('.records-block')).map((block) => [
      block.querySelector('h3')?.textContent,
      block.querySelector('pre')?.textContent,
    ])
    expect(blocks).toEqual([
      ['Arguments', JSON.stringify(['models', 'ensure', '--model', 'flux.ckpt'], null, 2)],
      ['Output', 'Downloading 40%'],
    ])
  })

  it('moves the selection with the arrow keys', async () => {
    await mount()
    await act(async () => options()[0]!.focus())
    await press('ArrowDown')

    expect(document.activeElement).toBe(options()[1])
    expect(readRecordDetail).toHaveBeenLastCalledWith('log', 9)
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
  })

  it('reads again with each filter, and searches once typing pauses', async () => {
    await mount()
    const selects = Array.from(document.querySelectorAll('select'))
    expect(Array.from(selects[0]!.options).map((option) => option.textContent)).toEqual([
      'All launches',
      expect.stringContaining('(this launch)'),
      expect.not.stringContaining('(this launch)'),
    ])
    expect(Array.from(selects[1]!.options).map((option) => option.textContent)).toEqual([
      'All sessions', '20261002-080000 (current session)', '20261001-080000',
    ])
    expect(Array.from(selects[2]!.options).map((option) => option.textContent)).toEqual(['All kinds', 'Log line', 'AI call', 'CLI job'])

    const choose = async (select: HTMLSelectElement, value: string) => {
      await act(async () => {
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    await choose(selects[0]!, LAUNCH)
    await choose(selects[1]!, SESSION)
    await choose(selects[2]!, 'ai-call')
    await choose(selects[3]!, 'error')
    expect(lastQuery()).toEqual({ launch: LAUNCH, session: SESSION, kind: 'ai-call', level: 'error', search: '', after: null })

    vi.useFakeTimers()
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(search, 'quota')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(lastQuery().search).toBe('')
    await act(async () => vi.advanceTimersByTime(300))
    expect(lastQuery().search).toBe('quota')
  })

  it('shows a loading note while the first page is read, then the rows', async () => {
    const first = deferred<RecordsPage>()
    readRecordsPage.mockReturnValueOnce(first.promise)
    await mount()

    expect(document.body.textContent).toContain('Loading records…')
    expect(document.body.textContent).not.toContain('No records match these filters.')
    expect(options()).toHaveLength(0)

    await act(async () => first.resolve({ records: [call, line], more: false }))
    expect(options()).toHaveLength(2)
    expect(document.body.textContent).not.toContain('Loading records…')
  })

  it('says when nothing matches, and lists the first record that arrives', async () => {
    readRecordsPage.mockResolvedValueOnce({ records: [], more: false })
    await mount()
    expect(document.body.textContent).toContain('No records match these filters.')
    expect(document.querySelector('[role="listbox"]')).toBeNull()

    vi.useFakeTimers()
    readRecordsPage.mockResolvedValueOnce({ records: [newer], more: false })
    await signal()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(titles()).toEqual(['Arrived while open'])
    expect(document.body.textContent).not.toContain('No records match these filters.')
  })

  it('offers Warnings and errors first among the levels, with every filter off', async () => {
    await mount()
    const level = document.querySelectorAll('select')[3]!
    expect(Array.from(level.options).map((option) => option.textContent)).toEqual([
      'All levels', 'Warnings and errors', 'Error', 'Warning', 'Info', 'Debug',
    ])
    for (const select of Array.from(document.querySelectorAll('select'))) expect(select.value).toBe('')
  })

  it('has no button for more rows or for refreshing', async () => {
    await mount()
    expect(document.querySelectorAll('button')).toHaveLength(0)
  })

  it('reads the next page from the last row once the list is scrolled near its end', async () => {
    readRecordsPage.mockResolvedValueOnce({ records: [call], more: true })
    readRecordsPage.mockResolvedValueOnce({ records: [line], more: false })
    await mount()
    expect(readRecordsPage).toHaveBeenCalledOnce()

    await scrollTo(700)

    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(lastQuery().after).toEqual(cursorOf(call))
    expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
  })

  it('reads the next page when ArrowDown or End reaches the last row', async () => {
    readRecordsPage.mockResolvedValueOnce({ records: [call, line], more: true })
    readRecordsPage.mockReturnValueOnce(new Promise<RecordsPage>(() => {}))
    await mount()
    await act(async () => options()[0]!.focus())
    await press('End')

    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(lastQuery().after).toEqual(cursorOf(line))
    expect(document.activeElement).toBe(options()[1])
  })

  it('makes one request for two scroll events together', async () => {
    readRecordsPage.mockResolvedValueOnce({ records: [call, line], more: true })
    readRecordsPage.mockReturnValueOnce(new Promise<RecordsPage>(() => {}))
    await mount()

    await scrollTo(800, 2)

    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(options()).toHaveLength(2)
    expect(document.body.textContent).toContain('Loading records…')
  })

  it('reads the next page by itself while a page does not fill the list', async () => {
    box.scrollHeight = 150
    readRecordsPage.mockResolvedValueOnce({ records: [call], more: true })
    readRecordsPage.mockResolvedValueOnce({ records: [line], more: false })
    await mount()

    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
  })

  it("keeps a failed page's note at the end, and reads it again when the end is reached again", async () => {
    readRecordsPage.mockResolvedValueOnce({ records: [call], more: true })
    readRecordsPage.mockRejectedValueOnce(new Error('busy'))
    readRecordsPage.mockResolvedValueOnce({ records: [line], more: false })
    await mount()

    await scrollTo(700)
    expect(document.body.textContent).toContain('The records could not be read.')
    expect(options()).toHaveLength(1)
    expect(readRecordsPage).toHaveBeenCalledTimes(2)

    await scrollTo(750)
    expect(readRecordsPage).toHaveBeenCalledTimes(3)
    expect(lastQuery().after).toEqual(cursorOf(call))
    expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
    expect(document.body.textContent).not.toContain('The records could not be read.')
  })

  it('re-reads the newest page once for a burst of new records while at the top, keeping the rows shown', async () => {
    await mount()
    vi.useFakeTimers()
    const next = deferred<RecordsPage>()
    readRecordsPage.mockReturnValueOnce(next.promise)

    await signal()
    await signal()
    await signal()
    await act(async () => vi.advanceTimersByTime(1000))

    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(lastQuery()).toEqual(NO_FILTERS)
    expect(readRecordSources).toHaveBeenCalledTimes(2)
    expect(options()).toHaveLength(2)
    expect(document.body.textContent).not.toContain('Loading records…')

    await act(async () => next.resolve({ records: [newer, call, line], more: false }))
    expect(titles()).toEqual(['Arrived while open', 'gemini brainstorm', 'Generation failed'])
  })

  it('leaves the list alone while scrolled down, and shows new records once back at the top', async () => {
    await mount()
    await scrollTo(300)
    vi.useFakeTimers()
    readRecordsPage.mockResolvedValueOnce({ records: [newer, call, line], more: false })

    await signal()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(readRecordsPage).toHaveBeenCalledOnce()
    expect(options()).toHaveLength(2)

    await scrollTo(0)
    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(titles()).toEqual(['Arrived while open', 'gemini brainstorm', 'Generation failed'])
  })

  it('keeps the selected record selected through an update', async () => {
    await mount()
    await act(async () => options()[1]!.click())
    vi.useFakeTimers()
    readRecordsPage.mockResolvedValueOnce({ records: [newer, call, line], more: false })

    await signal()
    await act(async () => vi.advanceTimersByTime(1000))

    expect(options()).toHaveLength(3)
    expect(options()[2]!.getAttribute('aria-selected')).toBe('true')
    expect(options()[2]!.tabIndex).toBe(0)
    expect(readRecordDetail).toHaveBeenCalledOnce()
  })

  it('stops reading on new-record signals after a failed read, so a logged failure cannot start the next read', async () => {
    await mount()
    vi.useFakeTimers()
    readRecordsPage.mockRejectedValueOnce(new Error('busy'))

    await signal()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(appLog).toHaveBeenCalledWith('error', 'Records read failed', expect.anything())

    await signal()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(readRecordsPage).toHaveBeenCalledTimes(2)
    expect(options()).toHaveLength(2)
  })

  it('stops listening for new records when it closes', async () => {
    await mount()
    expect(recordsChanged).not.toBeNull()
    await act(async () => root?.unmount())
    root = null
    expect(recordsChanged).toBeNull()
  })

  it('resizes from the keyboard and saves once on key release or blur', async () => {
    await mount()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    expect(splitter.tabIndex).toBe(0)
    await act(async () => {
      splitter.focus()
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, repeat: true }))
    })
    expect(splitter.getAttribute('aria-valuenow')).toBe('412')
    expect(updateUiState).not.toHaveBeenCalled()
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })) })
    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: 412 })
    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
      splitter.blur()
    })
    expect(updateUiState).toHaveBeenCalledTimes(2)
    expect(updateUiState).toHaveBeenLastCalledWith({ recordsListWidth: RECORDS_LIST_WIDTH.min })
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home', bubbles: true })) })
    expect(updateUiState).toHaveBeenCalledTimes(2)
  })

  it('keeps keyboard resizing inside the live pane bounds', async () => {
    box.shellWidth = RECORDS_WINDOW_MIN_WIDTH + 80
    await mount()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(splitter.getAttribute('aria-valuenow')).toBe('400')
    expect(splitter.getAttribute('aria-valuemax')).toBe('400')
    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      splitter.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: 400 })
  })

  it('saves the list width once when a drag ends, clamped to the pane bounds', async () => {
    await mount()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    expect(splitter.getAttribute('aria-label')).toBe('Resize list pane')

    await act(async () => {
      splitter.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0 }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 2000 }))
    })
    expect(updateUiState).not.toHaveBeenCalled()
    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })

    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: RECORDS_LIST_WIDTH.max })
    expect(shell().style.getPropertyValue('--records-list-width')).toBe(`${RECORDS_LIST_WIDTH.max}px`)
  })

  it('narrows the list when the window narrows, saving nothing', async () => {
    await mount()
    expect(shell().style.getPropertyValue('--records-list-width')).toBe(`${RECORDS_LIST_WIDTH.default}px`)

    await act(async () => {
      box.shellWidth = RECORDS_WINDOW_MIN_WIDTH
      for (const callback of resizeCallbacks) callback()
    })

    expect(shell().style.getPropertyValue('--records-list-width')).toBe(`${RECORDS_LIST_WIDTH.min}px`)
    expect(updateUiState).not.toHaveBeenCalled()
  })

  it('says when the records cannot be read, without the raw error', async () => {
    readRecordsPage.mockRejectedValue(new Error('SQLITE_CORRUPT /Users/someone/.imagequeue/records.sqlite3'))
    await mount()

    expect(document.body.textContent).toContain('The records could not be read.')
    expect(document.body.textContent).not.toContain('SQLITE_CORRUPT')
    expect(appLog).toHaveBeenCalled()
  })

  it('says when a selected record cannot be read', async () => {
    readRecordDetail.mockResolvedValue(null)
    await mount()
    await act(async () => options()[0]!.click())
    expect(document.body.textContent).toContain('This record could not be read.')
  })
})

describe('RecordsApp', () => {
  it('opens with the list at its saved width from the first frame', async () => {
    getUiState.mockResolvedValue({ columnWidth: null, notificationVolume: 0.7, recordsListWidth: 512 })
    await mount(React.createElement(RecordsApp))
    expect(shell().style.getPropertyValue('--records-list-width')).toBe('512px')
  })

  it('opens at the default width when the saved one cannot be read', async () => {
    getUiState.mockRejectedValue(new Error('state.json unreadable'))
    await mount(React.createElement(RecordsApp))
    expect(shell().style.getPropertyValue('--records-list-width')).toBe(`${RECORDS_LIST_WIDTH.default}px`)
  })
})
