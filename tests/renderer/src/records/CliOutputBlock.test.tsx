// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CliOutputBlock } from '../../../../src/renderer/src/records/CliOutputBlock'
import type { ElectronAPI } from '../../../../src/shared/electron-api'
import type { RecordsOutputPage } from '../../../../src/shared/records'

const read = vi.fn<ElectronAPI['readRecordOutput']>()
beforeEach(() => {
  read.mockReset()
  window.electronAPI = {
    readRecordOutput: read,
    appLog: vi.fn(async () => undefined),
  } as unknown as ElectronAPI
})
afterEach(cleanup)

function pendingPage(): { promise: Promise<RecordsOutputPage>; resolve: (page: RecordsOutputPage) => void } {
  let resolve!: (page: RecordsOutputPage) => void
  const promise = new Promise<RecordsOutputPage>((done) => { resolve = done })
  return { promise, resolve }
}

async function flush(): Promise<void> { await act(async () => {}) }
const previous = (): HTMLButtonElement => screen.getByRole('button', { name: 'Previous output page' })
const next = (): HTMLButtonElement => screen.getByRole('button', { name: 'Next output page' })

describe('stored CLI output pages', () => {
  it('keeps one exact page and re-reads previous pages using opaque offsets', async () => {
    read.mockImplementation(async (_id, _stream, offset) => offset === 0
      ? { text: 'first\rprogress\n\n', nextOffset: 901 }
      : { text: '\nsecond\n', nextOffset: null })
    const view = render(<CliOutputBlock recordId={2} stream="stdout" label="Output" />)
    await flush()
    expect(read).toHaveBeenLastCalledWith(2, 'stdout', 0)
    expect(view.container.querySelector('pre')?.textContent).toBe('first\rprogress\n\n')
    expect(previous().disabled).toBe(true)
    fireEvent.click(next())
    await flush()
    expect(read).toHaveBeenLastCalledWith(2, 'stdout', 901)
    expect(view.container.querySelectorAll('pre')).toHaveLength(1)
    expect(view.container.querySelector('pre')?.textContent).toBe('\nsecond\n')
    expect(next().disabled).toBe(true)
    fireEvent.click(previous())
    await flush()
    expect(read).toHaveBeenLastCalledWith(2, 'stdout', 0)
    expect(view.container.querySelector('pre')?.textContent).toBe('first\rprogress\n\n')
  })

  it('retains the shown page after a navigation failure and retries the requested offset', async () => {
    read.mockResolvedValueOnce({ text: 'first', nextOffset: 42 })
      .mockRejectedValueOnce(new Error('private output path'))
      .mockResolvedValueOnce({ text: 'second', nextOffset: null })
    const view = render(<CliOutputBlock recordId={2} stream="stderr" label="Error output" />)
    await flush()
    fireEvent.click(next())
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('This record could not be read.')
    expect(view.container.querySelector('pre')?.textContent).toBe('first')
    expect(view.container.textContent).not.toContain('private output path')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flush()
    expect(read).toHaveBeenLastCalledWith(2, 'stderr', 42)
    expect(view.container.querySelector('pre')?.textContent).toBe('second')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('allows only one pending read and ignores a previous record response after switching', async () => {
    const delayed = pendingPage()
    read.mockResolvedValueOnce({ text: 'first', nextOffset: 42 })
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce({ text: 'new record', nextOffset: null })
    const view = render(<CliOutputBlock key="2:stdout" recordId={2} stream="stdout" label="Output" />)
    await flush()
    fireEvent.click(next())
    expect(next().disabled).toBe(true)
    expect(previous().disabled).toBe(true)
    fireEvent.click(next())
    expect(read).toHaveBeenCalledTimes(2)
    view.rerender(<CliOutputBlock key="3:stdout" recordId={3} stream="stdout" label="Output" />)
    await flush()
    expect(view.container.querySelector('pre')?.textContent).toBe('new record')
    await act(async () => delayed.resolve({ text: 'stale old record', nextOffset: 900 }))
    expect(view.container.querySelector('pre')?.textContent).toBe('new record')
    expect(next().disabled).toBe(true)
  })

  it('offers retry when the first page cannot be read', async () => {
    read.mockRejectedValueOnce(new Error('cannot open output')).mockResolvedValueOnce({ text: 'recovered', nextOffset: null })
    const view = render(<CliOutputBlock recordId={2} stream="stdout" label="Output" />)
    await flush()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(view.container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flush()
    expect(view.container.querySelector('pre')?.textContent).toBe('recovered')
  })
})
