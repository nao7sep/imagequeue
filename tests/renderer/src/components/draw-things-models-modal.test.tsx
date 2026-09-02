// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliStatus, LocalModelInfo } from '../../../../src/shared/types'

vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => vi.fn(async () => true),
}))
vi.mock('../../../../src/renderer/src/context/CliJobsContext', () => ({
  useCliJobs: () => ({ addJob: vi.fn() }),
}))

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

    expect(await screen.findByText('No official models available.')).toBeTruthy()
    expect(screen.queryByText('No official models match this search.')).toBeNull()
  })

  it('distinguishes a filtered miss from an empty source', async () => {
    installApi([OFFICIAL_MODEL])
    render(<DrawThingsModelsModal onClose={vi.fn()} />)
    await screen.findByText('Alpha')

    fireEvent.change(screen.getByPlaceholderText('Search official models...'), {
      target: { value: 'does-not-match' },
    })

    expect(screen.getByText('No official models match this search.')).toBeTruthy()
    expect(screen.queryByText('No official models available.')).toBeNull()
  })

  it('renders one accessible load failure above the bounded model columns', async () => {
    installApi([], new Error('catalog unavailable'))
    render(<DrawThingsModelsModal onClose={vi.fn()} />)

    const alert = await screen.findByRole('alert')
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
    await screen.findByText('No official models available.')

    const input = screen.getByPlaceholderText('Model file path')
    fireEvent.change(input, { target: { value: '/chosen/model.ckpt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    const alert = await screen.findByRole('alert')
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
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByRole('button', { name: 'Hugging Face' }))
    const result = await screen.findByRole('alert')
    expect(result.textContent).toContain('model page could not be opened')
    expect(result.textContent).not.toMatch(/EACCES|private\/tmp|SENTINEL/i)
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error', 'Failed to open a Draw Things model link',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_MODEL_LINK_SENTINEL') }) }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hugging Face' }))
    await screen.findByText('Alpha')
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
