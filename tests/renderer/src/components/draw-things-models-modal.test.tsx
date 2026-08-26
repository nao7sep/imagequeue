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

function installApi(availableModels: LocalModelInfo[]): void {
  window.electronAPI = {
    localCheckCli: vi.fn(async () => CLI_OK),
    localListDownloadedModels: vi.fn(async () => []),
    localReadCustomJsonImportedFiles: vi.fn(async () => ({ kind: 'absent' as const })),
    localListAvailableModels: vi.fn(async () => availableModels),
    onCliJobStatus: vi.fn(() => () => undefined),
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
})
