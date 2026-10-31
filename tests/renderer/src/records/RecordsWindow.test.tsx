// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordsApp, RecordsWindow } from '../../../../src/renderer/src/records/RecordsWindow'
import type { ElectronAPI } from '../../../../src/shared/electron-api'
import { RECORDS_LIST_WIDTH, RECORDS_WINDOW_MIN_WIDTH } from '../../../../src/shared/records-layout'
import type { RecordDetail, RecordsPage, RecordsQuery, RecordSummary } from '../../../../src/shared/records'
import { I18nProvider } from '../../../../src/renderer/src/i18n/I18nContext'
import { createTranslator } from '../../../../src/shared/i18n/translate'
import { ENGLISH } from '../../../../src/shared/i18n/catalogues'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom omits CSS.escape, which the listbox layer uses to find a row.
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  ;(globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS = {
    escape: (value: string): string => String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch),
  }
}

const LAUNCH = '2026-10-02T08:00:00.000Z'
const SESSION = '20261002-080000-utc'

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
  signal: 'SIGTERM', hasStdout: true, hasStderr: false, outputError: null, error: null,
}
const newer: RecordSummary = {
  kind: 'log', id: 12, time: '2026-10-02T08:02:00.000Z', level: 'info', title: 'Arrived while open', text: null,
}

let root: Root | null = null
const readRecordsPage = vi.fn<ElectronAPI['readRecordsPage']>()
const readRecordDetail = vi.fn<ElectronAPI['readRecordDetail']>()
const readRecordOutput = vi.fn<ElectronAPI['readRecordOutput']>()
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
const capturedPointers = new Map<number, HTMLElement>()

// jsdom has no pointer capture. Release dispatches loss synchronously so the
// tests also exercise teardown before a capture-loss event can reenter it.
function pointer(target: EventTarget, type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}): void {
  const { pointerId = 7, pointerType = 'mouse', ...mouseInit } = init
  const event = new MouseEvent(type, { bubbles: true, ...mouseInit })
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType } })
  target.dispatchEvent(event)
}

class TestResizeObserver {
  private readonly elements = new Set<Element>()
  private readonly deliver: () => void
  constructor(callback: ResizeObserverCallback) {
    this.deliver = () => callback([...this.elements].map((target) => ({
      target, borderBoxSize: [{ inlineSize: 700, blockSize: (target as HTMLElement).offsetHeight }],
      contentRect: { width: 700, height: (target as HTMLElement).offsetHeight },
    })) as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
  }
  observe(element: Element): void { this.elements.add(element); resizeCallbacks.add(this.deliver) }
  unobserve(element: Element): void { this.elements.delete(element) }
  disconnect(): void { this.elements.clear(); resizeCallbacks.delete(this.deliver) }
}
const isScroll = (element: HTMLElement) => element.classList.contains('records-list-scroll')

beforeEach(() => {
  zone = 'UTC'
  readRecordsPage.mockReset()
  readRecordsPage.mockResolvedValue({ records: [call, line], more: false } satisfies RecordsPage)
  readRecordOutput.mockReset()
  readRecordOutput.mockResolvedValue({ text: 'Downloading 10%\rDownloading 40%\r', nextOffset: null })
  readRecordDetail.mockReset()
  readRecordDetail.mockImplementation(async (kind) => (kind === 'log' ? lineDetail : callDetail))
  readRecordSources.mockReset()
  readRecordSources.mockResolvedValue({
    currentLaunch: LAUNCH, currentSession: SESSION, launches: [LAUNCH, '2026-10-01T08:00:00.000Z'], sessions: [SESSION, '20261001-080000-utc'],
  })
  appLog.mockReset()
  appLog.mockResolvedValue()
  updateUiState.mockReset()
  updateUiState.mockImplementation(async (patch) => ({ columnWidth: null, recordsListWidth: RECORDS_LIST_WIDTH.default, ...patch }))
  getUiState.mockReset()
  onRecordsChanged.mockClear()
  recordsChanged = null
  Object.assign(box, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 })
  resizeCallbacks.clear()
  capturedPointers.clear()
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get(this: HTMLElement) { return isScroll(this) ? box.clientHeight : 76 } },
    offsetWidth: { configurable: true, get() { return 700 } },
    scrollTo: { configurable: true, value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop
      this.dispatchEvent(new Event('scroll'))
    } },
    setPointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) { capturedPointers.set(pointerId, this) },
    },
    hasPointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) { return capturedPointers.get(pointerId) === this },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        if (!this.hasPointerCapture(pointerId)) return
        capturedPointers.delete(pointerId)
        pointer(this, 'lostpointercapture', { pointerId })
      },
    },
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
      readRecordsPage, readRecordDetail, readRecordOutput, readRecordSources, appLog, updateUiState, getUiState, onRecordsChanged,
    } satisfies Partial<ElectronAPI>,
  })
})

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const name of ['offsetHeight', 'offsetWidth', 'scrollTo', 'scrollTop', 'scrollHeight', 'clientHeight', 'clientWidth', 'setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
  }
})

async function mount(element: React.ReactElement = React.createElement(RecordsWindow, { initialListWidth: RECORDS_LIST_WIDTH.default })): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  // Times show in the display zone; these tests pin it.
  await act(async () => root?.render(React.createElement(I18nProvider, { translator: createTranslator('en', ENGLISH, 'en', zone), children: element })))
}

let zone = 'UTC'
const shown = (iso: string): string =>
  new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'medium', timeZone: zone }).format(new Date(iso))

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
    for (const text of ['gemini-x', 'brainstorm', 'req-1', '2.5', `${shown('2026-10-02T08:00:00Z')} (current session)`, '(this launch)']) {
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

  it('reads only flagged output streams and keeps archival failure details out of the interface', async () => {
    readRecordsPage.mockResolvedValue({ records: [job], more: false })
    readRecordDetail.mockResolvedValue({ ...jobDetail, hasStdout: false, hasStderr: true, outputError: 'EACCES /private/output-transcript' })
    readRecordOutput.mockResolvedValue({ text: 'stderr page\n', nextOffset: null })
    await mount()
    await act(async () => options()[0]!.click())
    expect(readRecordOutput).toHaveBeenCalledExactlyOnceWith(2, 'stderr', 0)
    const labels = [...document.querySelectorAll('.records-block-label')].map((label) => label.textContent)
    expect(labels).toContain('Error output')
    expect(labels).not.toContain('Output')
    expect(document.querySelector('.records-detail-body')?.textContent).toContain('Some output could not be recorded.')
    expect(document.querySelector('.records-detail-body')?.textContent).not.toContain('/private/output-transcript')
  })

  it('shows everything a selected CLI job holds, its paged output exactly as received', async () => {
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
      Job: 'job-abc', Session: `${shown('2026-10-02T08:00:00Z')} (current session)`,
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
      ['Output', 'Downloading 10%\rDownloading 40%\r'],
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

  it('shows every time in the display zone', async () => {
    zone = 'Asia/Tokyo'
    await mount()
    const sessions = Array.from(document.querySelectorAll('select')[1]!.options).map((option) => option.textContent)
    expect(sessions[1]).toBe(`${shown('2026-10-02T08:00:00Z')} (current session)`)
    expect(sessions[1]).toContain('5:00:00')
    expect(document.body.textContent).toContain(shown('2026-10-02T08:01:00.000Z'))
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
      'All sessions', `${shown('2026-10-02T08:00:00Z')} (current session)`, shown('2026-10-01T08:00:00Z'),
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
    expect(document.querySelector<HTMLElement>('[role="listbox"]')?.tabIndex).toBe(0)

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

  it('resizes from the keyboard and saves once after the last step, or at once on blur', async () => {
    await mount()
    vi.useFakeTimers()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    expect(splitter.tabIndex).toBe(0)
    await act(async () => {
      splitter.focus()
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      splitter.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    await act(async () => vi.advanceTimersByTime(400))
    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      splitter.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    expect(splitter.getAttribute('aria-valuenow')).toBe('412')
    await act(async () => vi.advanceTimersByTime(400))
    expect(updateUiState).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(100))
    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: 412 })
    await act(async () => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
      splitter.blur()
    })
    expect(updateUiState).toHaveBeenCalledTimes(2)
    expect(updateUiState).toHaveBeenLastCalledWith({ recordsListWidth: RECORDS_LIST_WIDTH.min })
    await act(async () => vi.advanceTimersByTime(1000))
    expect(updateUiState).toHaveBeenCalledTimes(2)
  })

  it('keeps keyboard resizing inside the live pane bounds', async () => {
    box.shellWidth = RECORDS_WINDOW_MIN_WIDTH + 80
    await mount()
    vi.useFakeTimers()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(splitter.getAttribute('aria-valuenow')).toBe('400')
    expect(splitter.getAttribute('aria-valuemax')).toBe('400')
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    await act(async () => vi.advanceTimersByTime(500))
    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: 400 })
  })

  it('saves a keyboard width still waiting when the window closes', async () => {
    await mount()
    vi.useFakeTimers()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    await act(async () => { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    await act(async () => root?.unmount())
    root = null
    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: 396 })
  })

  it('saves the list width once when a drag ends, clamped to the pane bounds', async () => {
    await mount()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    expect(splitter.getAttribute('aria-label')).toBe('Resize list pane')

    await act(async () => {
      pointer(splitter, 'pointerdown', { clientX: 0 })
      pointer(window, 'pointermove', { clientX: 100 })
      pointer(window, 'pointermove', { clientX: 2000 })
    })
    expect(splitter.hasPointerCapture(7)).toBe(true)
    expect(updateUiState).not.toHaveBeenCalled()
    await act(async () => {
      pointer(window, 'pointerup')
    })

    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: RECORDS_LIST_WIDTH.max })
    expect(shell().style.getPropertyValue('--records-list-width')).toBe(`${RECORDS_LIST_WIDTH.max}px`)
    expect(splitter.hasPointerCapture(7)).toBe(false)
  })

  it.each(['pointercancel', 'lostpointercapture', 'blur'] as const)('cancels a drag on %s, restores the body styles, and accepts the next gesture', async (ending) => {
    document.body.style.cursor = 'crosshair'
    document.body.style.userSelect = 'text'
    await mount()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    await act(async () => {
      pointer(splitter, 'pointerdown', { clientX: 10 })
      pointer(window, 'pointermove', { clientX: 110 })
    })
    expect(splitter.getAttribute('aria-valuenow')).toBe('480')
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    await act(async () => {
      if (ending === 'lostpointercapture') splitter.releasePointerCapture(7)
      else if (ending === 'blur') window.dispatchEvent(new Event('blur'))
      else pointer(window, ending)
    })
    expect(splitter.getAttribute('aria-valuenow')).toBe('380')
    expect(splitter.hasPointerCapture(7)).toBe(false)
    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('text')
    await act(async () => {
      pointer(window, 'pointermove', { clientX: 1000 })
      pointer(window, 'pointerup')
      pointer(window, 'pointercancel')
      pointer(splitter, 'lostpointercapture')
    })
    expect(splitter.getAttribute('aria-valuenow')).toBe('380')
    expect(updateUiState).not.toHaveBeenCalled()
    await act(async () => {
      pointer(splitter, 'pointerdown', { clientX: 20, pointerId: 8 })
      pointer(window, 'pointermove', { clientX: 70, pointerId: 8 })
      pointer(window, 'pointerup', { pointerId: 8 })
    })
    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: 430 })
    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('text')
  })

  it('ignores secondary mouse buttons and pointers other than the one resizing', async () => {
    await mount()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    await act(async () => {
      pointer(splitter, 'pointerdown', { button: 2 })
      pointer(window, 'pointermove', { clientX: 100 })
      pointer(window, 'pointerup')
    })
    expect(splitter.getAttribute('aria-valuenow')).toBe('380')
    expect(capturedPointers.size).toBe(0)
    expect(updateUiState).not.toHaveBeenCalled()
    await act(async () => {
      pointer(splitter, 'pointerdown', { clientX: 10 })
      pointer(window, 'pointermove', { clientX: 60 })
      pointer(splitter, 'pointerdown', { clientX: 100, pointerId: 8 })
      pointer(window, 'pointermove', { clientX: 1000, pointerId: 8 })
      pointer(window, 'pointerup', { pointerId: 8 })
      pointer(window, 'pointercancel', { pointerId: 8 })
      pointer(splitter, 'lostpointercapture', { pointerId: 8 })
    })
    expect(splitter.getAttribute('aria-valuenow')).toBe('430')
    expect(splitter.hasPointerCapture(7)).toBe(true)
    expect(splitter.hasPointerCapture(8)).toBe(false)
    expect(updateUiState).not.toHaveBeenCalled()
    await act(async () => pointer(window, 'pointerup'))
    expect(updateUiState).toHaveBeenCalledExactlyOnceWith({ recordsListWidth: 430 })
  })

  it('releases an active drag and restores the body styles when the window unmounts', async () => {
    document.body.style.cursor = 'crosshair'
    document.body.style.userSelect = 'text'
    await mount()
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!
    await act(async () => {
      pointer(splitter, 'pointerdown')
      pointer(window, 'pointermove', { clientX: 100 })
    })
    await act(async () => root?.unmount())
    root = null
    expect(splitter.hasPointerCapture(7)).toBe(false)
    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('text')
    await act(async () => {
      pointer(window, 'pointermove', { clientX: 1000 })
      pointer(window, 'pointerup')
      pointer(window, 'pointercancel')
      pointer(splitter, 'lostpointercapture')
      window.dispatchEvent(new Event('blur'))
    })
    expect(updateUiState).not.toHaveBeenCalled()
    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('text')
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
    getUiState.mockResolvedValue({ columnWidth: null, recordsListWidth: 512 })
    await mount(React.createElement(RecordsApp))
    expect(shell().style.getPropertyValue('--records-list-width')).toBe('512px')
  })

  it('opens at the default width when the saved one cannot be read', async () => {
    getUiState.mockRejectedValue(new Error('state.json unreadable'))
    await mount(React.createElement(RecordsApp))
    expect(shell().style.getPropertyValue('--records-list-width')).toBe(`${RECORDS_LIST_WIDTH.default}px`)
  })
})

it('retains rows and selection after a live failure, then retries and resumes updates', async () => {
  await mount()
  await act(async () => options()[0]!.click())
  vi.useFakeTimers()
  readRecordsPage.mockRejectedValueOnce(new Error('EACCES /private/records SENTINEL'))
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
  expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
  expect(document.body.textContent).toContain('Live updates are paused.')
  expect(document.body.textContent).not.toContain('SENTINEL')
  const reads = readRecordsPage.mock.calls.length
  await signal()
  await act(async () => vi.advanceTimersByTime(2000))
  expect(readRecordsPage).toHaveBeenCalledTimes(reads)

  const retry = deferred<RecordsPage>()
  readRecordsPage.mockReturnValueOnce(retry.promise)
  await act(async () => document.querySelector<HTMLButtonElement>('.records-refresh-failure button')!.click())
  expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
  expect(document.querySelector<HTMLButtonElement>('.records-refresh-failure button')!.disabled).toBe(true)
  await act(async () => retry.resolve({ records: [newer, call, line], more: false }))
  expect(document.querySelector('.records-refresh-failure')).toBeNull()
  expect(titles()).toEqual(['Arrived while open', 'gemini brainstorm', 'Generation failed'])
  expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(readRecordsPage).toHaveBeenCalledTimes(reads + 2)
})

it('does not clear a source-filter failure when the independent page read succeeds', async () => {
  await mount()
  vi.useFakeTimers()
  readRecordSources.mockRejectedValueOnce(new Error('sources unavailable'))
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
  expect(document.body.textContent).toContain('Live updates are paused.')
  const sources = deferred<Awaited<ReturnType<ElectronAPI['readRecordSources']>>>()
  readRecordSources.mockReturnValueOnce(sources.promise)
  await act(async () => document.querySelector<HTMLButtonElement>('.records-refresh-failure button')!.click())
  expect(document.body.textContent).toContain('Live updates are paused.')
  await act(async () => sources.resolve({ currentLaunch: LAUNCH, currentSession: SESSION, launches: [LAUNCH], sessions: [SESSION] }))
  expect(document.querySelector('.records-refresh-failure')).toBeNull()
})

it('coalesces live signals while the newest page is pending', async () => {
  await mount()
  vi.useFakeTimers()
  const held = deferred<RecordsPage>()
  readRecordsPage.mockReturnValueOnce(held.promise)
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(readRecordsPage).toHaveBeenCalledTimes(2)
  await act(async () => held.resolve({ records: [newer, call, line], more: false }))
  expect(readRecordsPage).toHaveBeenCalledTimes(3)
  expect(titles()).toEqual(['Arrived while open', 'gemini brainstorm', 'Generation failed'])
})

it('coalesces source reads and updates once after hidden-window changes', async () => {
  await mount()
  vi.useFakeTimers()
  const held = deferred<Awaited<ReturnType<ElectronAPI['readRecordSources']>>>()
  readRecordSources.mockReturnValueOnce(held.promise)
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(readRecordSources).toHaveBeenCalledTimes(2)
  await act(async () => held.resolve({ currentLaunch: LAUNCH, currentSession: SESSION, launches: [LAUNCH], sessions: [SESSION] }))
  expect(readRecordSources).toHaveBeenCalledTimes(3)
  const pages = readRecordsPage.mock.calls.length
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await signal()
  await signal()
  await act(async () => vi.advanceTimersByTime(3000))
  expect(readRecordSources).toHaveBeenCalledTimes(3)
  expect(readRecordsPage).toHaveBeenCalledTimes(pages)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => vi.advanceTimersByTime(1000))
  expect(readRecordSources).toHaveBeenCalledTimes(4)
  expect(readRecordsPage).toHaveBeenCalledTimes(pages + 1)
  vi.restoreAllMocks()
})

it('shows intact partial search matches, pauses live reads and explicitly restarts the search', async () => {
  readRecordsPage.mockResolvedValueOnce({ records: [call, line], more: false, searchIncomplete: true })
  await mount()
  await act(async () => options()[0]!.click())
  expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
  expect(document.body.textContent).toContain('Some CLI output could not be searched.')
  vi.useFakeTimers()
  await signal()
  await act(async () => vi.advanceTimersByTime(2000))
  expect(readRecordsPage).toHaveBeenCalledOnce()
  const retry = deferred<RecordsPage>()
  readRecordsPage.mockReturnValueOnce(retry.promise)
  await act(async () => document.querySelector<HTMLButtonElement>('.records-refresh-failure button')!.click())
  expect(lastQuery().after).toBeNull()
  await act(async () => retry.resolve({ records: [call, line], more: false }))
  expect(document.querySelector('.records-refresh-failure')).toBeNull()
  expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(readRecordsPage).toHaveBeenCalledTimes(3)
})

it('queues live refresh behind initial hydration and keeps the newer partial-result warning', async () => {
  const initial = deferred<RecordsPage>()
  readRecordsPage.mockReturnValueOnce(initial.promise)
  await mount()
  vi.useFakeTimers()
  readRecordsPage.mockResolvedValueOnce({ records: [newer, call], more: false, searchIncomplete: true })
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(readRecordsPage).toHaveBeenCalledOnce()
  await act(async () => initial.resolve({ records: [call], more: false }))
  expect(readRecordsPage).toHaveBeenCalledTimes(2)
  expect(document.body.textContent).toContain('Some CLI output could not be searched.')
  expect(titles()).toEqual(['Arrived while open', 'gemini brainstorm'])
})

it('virtualizes loaded history while preserving offscreen keyboard selection', async () => {
  const rows: RecordSummary[] = Array.from({ length: 300 }, (_, index) => ({
    kind: 'log', id: 300 - index, time: new Date((300 - index) * 1000).toISOString(),
    level: 'info', title: `History row ${300 - index}`, text: null,
  }))
  readRecordsPage.mockImplementation(async ({ after }) => {
    const start = after ? rows.findIndex((row) => row.id === after.id) + 1 : 0
    return { records: rows.slice(start, start + 100), more: start + 100 < rows.length }
  })
  box.scrollHeight = 300 * 78
  await mount()
  expect(options().length).toBeLessThan(20)
  await act(async () => options()[0]!.focus())
  await press('End')
  await press('End')
  await press('End')
  expect(document.activeElement?.getAttribute('data-listbox-option')).toBe('log:1')
  expect(readRecordDetail).toHaveBeenLastCalledWith('log', 1)
  expect(options().length).toBeLessThan(20)
  await scrollTo(50 * 78)
  expect(titles()).toContain('History row 250')
  expect(options().find((row) => row.dataset.listboxOption === 'log:1')?.tabIndex).toBe(0)
  await scrollTo(0)
  expect(titles()).toContain('History row 300')
  expect(options().length).toBeLessThan(20)
  expect(readRecordDetail).toHaveBeenLastCalledWith('log', 1)
})

it('bridges a burst larger than a page and retains the selected old record', async () => {
  vi.useFakeTimers()
  let newestId = 2
  const makeRow = (id: number): RecordSummary => ({ kind: 'log', id, time: new Date(id * 1000).toISOString(), level: 'info', title: `Burst row ${id}`, text: null })
  readRecordsPage.mockImplementation(async ({ after }) => {
    const end = after ? after.id - 1 : newestId
    return { records: Array.from({ length: Math.min(100, end) }, (_, i) => makeRow(end - i)), more: end > 100 }
  })
  box.scrollHeight = 40000
  await mount()
  await act(async () => options()[1]!.click())
  newestId = 352
  await act(async () => { recordsChanged!(); await vi.advanceTimersByTimeAsync(1000) })
  expect(readRecordsPage.mock.calls.slice(1).map(([query]) => query.after?.id ?? null)).toEqual([null, 253, 153, 53])
  expect(options()[0]?.getAttribute('aria-setsize')).toBe('352')
  expect(readRecordDetail).toHaveBeenLastCalledWith('log', 1)
  await scrollTo(200 * 78)
  expect(titles()).toContain('Burst row 152')
  expect(options().length).toBeLessThan(20)
})

it('keeps an empty or loading history reachable as the same listbox', async () => {
  const waiting = deferred<RecordsPage>()
  readRecordsPage.mockReturnValueOnce(waiting.promise)
  await mount()
  const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!
  expect(listbox.tabIndex).toBe(0)
  expect(listbox.textContent).toContain('Loading')
  await act(async () => waiting.resolve({ records: [], more: false }))
  expect(document.querySelector('[role="listbox"]')).toBe(listbox)
  expect(listbox.tabIndex).toBe(0)
  expect(listbox.textContent).toContain('No records')
})

it('keeps the list still when a newest page read at the top lands after the list was scrolled down', async () => {
  await mount()
  vi.useFakeTimers()
  const late = deferred<RecordsPage>()
  readRecordsPage.mockReturnValueOnce(late.promise)
  await signal()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(readRecordsPage).toHaveBeenCalledTimes(2)
  await scrollTo(300)
  await act(async () => late.resolve({ records: [newer, call, line], more: false }))
  expect(titles()).toEqual(['gemini brainstorm', 'Generation failed'])
  expect(readRecordsPage).toHaveBeenCalledTimes(2)

  readRecordsPage.mockResolvedValueOnce({ records: [newer, call, line], more: false })
  await scrollTo(0)
  expect(readRecordsPage).toHaveBeenCalledTimes(3)
  expect(titles()).toEqual(['Arrived while open', 'gemini brainstorm', 'Generation failed'])
})

it('pages through 10,000 records while new ones arrive live, moving nothing while scrolled down', async () => {
  // The records store: every record newest first, read a page at a time from a
  // cursor, as the records thread answers.
  const ROW = 78
  const stored: RecordSummary[] = []
  const store = (count: number, label: string): void => {
    for (let index = 0; index < count; index++) {
      const id = stored.length + 1
      stored.unshift({ kind: 'log', id, time: new Date(Date.UTC(2026, 9, 1) + id * 1000).toISOString(), level: 'info', title: `${label} ${id}`, text: null })
    }
  }
  store(10_000, 'Seed record')
  readRecordsPage.mockImplementation(async ({ after }) => {
    const start = after ? stored.findIndex((record) => record.id === after.id) + 1 : 0
    return { records: stored.slice(start, start + 100), more: start + 100 < stored.length }
  })
  const setSize = () => Number(options()[0]?.getAttribute('aria-setsize'))
  const arrive = async (count: number) => {
    store(count, 'Live record')
    await act(async () => { recordsChanged!(); await vi.advanceTimersByTimeAsync(1000) })
  }
  vi.useFakeTimers()
  box.scrollHeight = 100 * ROW
  await mount()

  // The first page: 100 records, newest first.
  expect(setSize()).toBe(100)
  expect(titles()[0]).toBe('Seed record 10000')

  // At the top, records stored now appear at the top on their own.
  await arrive(3)
  expect(titles()[0]).toBe('Live record 10003')
  expect(setSize()).toBe(103)

  // Scrolled down with a record selected, stored records move nothing; back at
  // the top they are there, and the selection and its detail stayed.
  box.scrollHeight = 103 * ROW
  await scrollTo(30 * ROW)
  await act(async () => options()[1]!.click())
  const before = titles()
  const chosen = document.querySelector('[aria-selected="true"]')!.getAttribute('data-listbox-option')!
  const chosenTitle = document.querySelector('[aria-selected="true"] .records-row-title')!.textContent
  const detailCalls = readRecordDetail.mock.calls.length
  const reads = readRecordsPage.mock.calls.length
  for (let tick = 0; tick < 5; tick++) await arrive(3)
  expect(titles()).toEqual(before)
  expect(setSize()).toBe(103)
  expect(box.scrollTop).toBe(30 * ROW)
  expect(readRecordsPage.mock.calls.length).toBe(reads)
  await scrollTo(0)
  expect(titles()[0]).toBe('Live record 10018')
  expect(setSize()).toBe(118)
  expect(readRecordDetail.mock.calls.length).toBe(detailCalls)
  // The chosen record sits 15 rows lower now; scrolled to it, it is still the
  // selected one.
  box.scrollHeight = setSize() * ROW
  await scrollTo(stored.findIndex((record) => record.title === chosenTitle) * ROW)
  const chosenRow = document.querySelector(`[data-listbox-option="${CSS.escape(chosen)}"]`)
  expect(chosenRow?.querySelector('.records-row-title')?.textContent).toBe(chosenTitle)
  expect(chosenRow?.getAttribute('aria-selected')).toBe('true')
  expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(1)

  // Walking to the end reads each older page once, each from the last record
  // the one before it ended on, until every record is loaded.
  const pagesBefore = readRecordsPage.mock.calls.length
  for (let guard = 0; guard < 200 && setSize() < stored.length; guard++) {
    box.scrollHeight = setSize() * ROW
    await scrollTo(box.scrollHeight - box.clientHeight)
  }
  expect(setSize()).toBe(stored.length)
  const cursors = readRecordsPage.mock.calls.slice(pagesBefore).map(([query]) => query.after!.id)
  expect(new Set(cursors).size).toBe(cursors.length)
  expect(cursors).toEqual([...cursors].sort((a, b) => b - a))
  expect(cursors.at(-1)).toBe(stored[stored.length - 101]!.id)
})
