// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliStatus, LocalModelInfo } from '../../../../src/shared/types'
import { until } from '../../until'

vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => vi.fn(async () => true),
}))
vi.mock('../../../../src/renderer/src/context/CliJobsContext', () => ({
  useCliJobs: () => ({ addJob: vi.fn() }),
}))


// jsdom lacks the CSSOM escape used by the listbox's real focus lookup.
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  ;(globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
    escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => '\\' + character),
  }
}

const { DrawThingsModelsModal } = await import('../../../../src/renderer/src/components/DrawThingsModelsModal')

const CLI_OK: CliStatus = {
  installed: true,
  version: '1.0.0',
  path: '/usr/local/bin/drawthings',
  platform: 'darwin',
}

const OFFICIAL_MODEL: LocalModelInfo = {
  file: 'alpha.ckpt',
  name: 'Alpha',
  source: 'official',
  downloaded: false,
  huggingFace: null,
}

function installApi(availableModels: LocalModelInfo[], availableError?: Error): void {
  window.electronAPI = {
    reportUnsavedDraft: vi.fn(async () => undefined),
    localCheckCli: vi.fn(async () => CLI_OK),
    localListDownloadedModels: vi.fn(async () => []),
    localReadCustomJsonImportedFiles: vi.fn(async () => ({ kind: 'absent' as const })),
    localListAvailableModels: availableError
      ? vi.fn(async () => { throw availableError })
      : vi.fn(async () => availableModels),
    onCliJobStatus: vi.fn(() => () => undefined),
    openFileDialog: vi.fn(async () => null),
    cliStartImport: vi.fn(async () => 'job-1'),
    cliStartDownload: vi.fn(async () => 'job-2'),
    appLog: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
}

beforeEach(() => installApi([]))
afterEach(cleanup)

describe('DrawThingsModelsModal empty states', () => {
  it('reports an actually empty source without calling it a search miss', async () => {
    render(<DrawThingsModelsModal onClose={vi.fn()} />)

    expect(await until(() => screen.getByText('No official models available.'))).toBeTruthy()
    expect(screen.queryByText('No official models match this search.')).toBeNull()
  })

  it('distinguishes a filtered miss from an empty source', async () => {
    installApi([OFFICIAL_MODEL])
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await until(() => screen.getByText('Alpha'))

    fireEvent.change(screen.getByPlaceholderText('Search official models'), {
      target: { value: 'does-not-match' },
    })

    expect(screen.getByText('No official models match this search.')).toBeTruthy()
    expect(screen.queryByText('No official models available.')).toBeNull()
  })

  it('renders one accessible load failure above the bounded model columns', async () => {
    installApi([], new Error('catalog unavailable'))
    render(<DrawThingsModelsModal onClose={vi.fn()} />)

    const alert = await until(() => screen.getByRole('alert'))
    expect(alert.textContent).toContain('Available Draw Things models could not be loaded')
    expect(alert.textContent).not.toContain('catalog unavailable')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    const body = alert.parentElement
    expect(body?.classList.contains('dt-modal-body')).toBe(true)
    expect(body?.querySelector('.dt-model-columns')).toBeTruthy()
    expect(body?.firstElementChild).toBe(alert)
  })
})

describe('DrawThingsModelsModal operation failures', () => {
  it('retains the selected import path, authors the result, and logs hostile diagnostics', async () => {
    installApi([])
    const hostile = new Error('EACCES /private/tmp/IMAGEQUEUE_IMPORT_SENTINEL')
    vi.mocked(window.electronAPI.cliStartImport).mockRejectedValue(hostile)
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await until(() => screen.getByText('No official models available.'))

    const input = screen.getByPlaceholderText('Model file path')
    fireEvent.change(input, { target: { value: '/chosen/model.ckpt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const alert = await until(() => screen.getByRole('alert'))
    expect(alert.textContent).toContain('selected path is unchanged')
    expect(alert.textContent).not.toContain('IMAGEQUEUE_IMPORT_SENTINEL')
    expect((input as HTMLInputElement).value).toBe('/chosen/model.ckpt')
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error',
      'Renderer operation failed',
      expect.objectContaining({ operation: 'drawthings-import', error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_IMPORT_SENTINEL') }) }),
    )
  })

  it('owns model-link rejection locally and clears it after a matching success', async () => {
    installApi([{ ...OFFICIAL_MODEL, huggingFace: 'org/alpha' }])
    const hostile = new Error('EACCES /private/tmp/IMAGEQUEUE_MODEL_LINK_SENTINEL')
    vi.mocked(window.electronAPI.openExternal)
      .mockRejectedValueOnce(hostile)
      .mockResolvedValueOnce(undefined)
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await until(() => screen.getByText('Alpha'))

    fireEvent.click(screen.getByRole('button', { name: 'Hugging Face' }))
    const result = await until(() => screen.getByRole('alert'))
    expect(result.textContent).toContain('model page could not be opened')
    expect(result.textContent).not.toMatch(/EACCES|private\/tmp|SENTINEL/i)
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error', 'Failed to open a Draw Things model link',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_MODEL_LINK_SENTINEL') }) }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hugging Face' }))
    await until(() => screen.getByText('Alpha'))
    await until(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('DrawThingsModelsModal Browse context', () => {
  it('passes the current draft and repeated selection, preserving Cancel', async () => {
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await until(() => screen.getByText('No official models available.'))
    const input = screen.getByPlaceholderText('Model file path') as HTMLInputElement
    const browse = screen.getByRole('button', { name: 'Browse' })
    fireEvent.click(browse)
    await until(() => expect(window.electronAPI.openFileDialog).toHaveBeenLastCalledWith([], '', 'model-import'))
    fireEvent.change(input, { target: { value: '~/models/draft.ckpt' } })
    const picked = '/models/ $HOME%MODEL%.ckpt '
    vi.mocked(window.electronAPI.openFileDialog).mockResolvedValueOnce(picked)
    fireEvent.click(browse)
    await until(() => expect(input.value).toBe(picked))
    expect(window.electronAPI.openFileDialog).toHaveBeenLastCalledWith([], '~/models/draft.ckpt', 'model-import')
    fireEvent.click(browse)
    await until(() => expect(window.electronAPI.openFileDialog).toHaveBeenLastCalledWith([], picked, 'model-import'))
    expect(input.value).toBe(picked)
  })
})


describe('model selected actions', () => {
  it('targets the keyboard active model for links and download without activating on arrow movement', async () => {
    installApi([OFFICIAL_MODEL, { ...OFFICIAL_MODEL, file: 'beta.ckpt', name: 'Beta', huggingFace: 'org/beta' }])
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await until(() => screen.getByText('Beta'))
    const list = screen.getByRole('listbox', { name: 'Official models' })
    const rows = within(list).getAllByRole('option')
    act(() => rows[0].focus())
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    expect(window.electronAPI.cliStartDownload).not.toHaveBeenCalled()
    expect(list.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    fireEvent.keyDown(rows[1], { key: 'ContextMenu' })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Open on Hugging Face: org/beta' })) })
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://huggingface.co/org/beta')
    const trigger = document.activeElement as HTMLButtonElement
    expect(trigger.textContent).toBe('Actions')
    expect(list.contains(trigger)).toBe(false)
    fireEvent.click(trigger)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Download' })) })
    expect(window.electronAPI.cliStartDownload).toHaveBeenCalledWith('beta.ckpt')
  })

  it('disables downloading an already installed active model', async () => {
    installApi([{ ...OFFICIAL_MODEL, downloaded: true }])
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await until(() => screen.getByText('Alpha'))
    const row = screen.getByRole('option')
    act(() => row.focus())
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    expect((screen.getByRole('menuitem', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }))
    expect(window.electronAPI.cliStartDownload).not.toHaveBeenCalled()
  })
})


describe('Draw Things model job settlement', () => {
  it('refreshes installed models after timeout, but waits while a process is still stopping', async () => {
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await until(() => screen.getByText('No official models available.'))
    const refresh = vi.mocked(window.electronAPI.localListDownloadedModels)
    const initialCalls = refresh.mock.calls.length
    const onStatus = vi.mocked(window.electronAPI.onCliJobStatus).mock.calls[0][0]
    act(() => onStatus({ jobId: 'job-1', status: 'stopping', exitCode: null, stalled: false }))
    expect(refresh).toHaveBeenCalledTimes(initialCalls)
    act(() => onStatus({ jobId: 'job-1', status: 'timed-out', exitCode: null, stalled: false }))
    await until(() => expect(refresh).toHaveBeenCalledTimes(initialCalls + 1))
  })
})
