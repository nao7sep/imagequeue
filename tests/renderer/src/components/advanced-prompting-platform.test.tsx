// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createEmptySessionDraft } from '../../../../src/shared/session-draft'
import type { LocalModelInfo } from '../../../../src/shared/types'
import { until } from '../../until'

// Draw Things runs only on macOS, so its targets, its scopes and the loading
// of its downloaded models appear there and nowhere else. The platform is read
// once when the modal is imported, so each case imports it afresh.

vi.mock('../../../../src/renderer/src/hooks/useBrainstormOperation', () => ({
  useBrainstormOperation: () => ({ progress: null, run: vi.fn(), cancel: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {},
    apiKeyPresence: { image: { openai: true, nanobanana: true, grok: true, flux: true }, geminiText: true, openaiText: true },
  }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('../../../../src/renderer/src/context/EnqueueConfigContext', () => ({
  useEnqueueConfigs: () => ({ snapshots: {} }),
}))
vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    state: { ...createEmptySessionDraft(), elaboratedPrompts: [], seed: 'a fox' },
    update: vi.fn(),
    appendElaboratedPrompts: vi.fn(),
  }),
}))

const MODELS: LocalModelInfo[] = [
  { file: 'flux_dev_q8p.ckpt', name: 'FLUX.1 Dev', source: 'official', downloaded: true, huggingFace: null },
]

let localListDownloadedModels: ReturnType<typeof vi.fn>

async function openOn(platform: string): Promise<void> {
  Object.assign(window, {
    electronAPI: {
      platform,
      appLog: vi.fn().mockResolvedValue(undefined),
      listElaborators: vi.fn().mockResolvedValue([]),
      localListDownloadedModels,
      localCheckCli: vi.fn().mockResolvedValue({ installed: true, version: '1', path: '/cli', platform: 'darwin' }),
      onCliJobStatus: vi.fn(() => () => {}),
    },
  })
  vi.resetModules()
  const { AdvancedPromptingModal } = await import('../../../../src/renderer/src/components/AdvancedPromptingModal')
  render(<AdvancedPromptingModal onClose={() => {}} />)
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  localListDownloadedModels = vi.fn().mockResolvedValue(MODELS)
})
afterEach(cleanup)

describe('Advanced Prompting on macOS', () => {
  it('lists the downloaded Draw Things models as targets beside the cloud ones', async () => {
    await openOn('darwin')
    expect(screen.getByText('Proprietary')).not.toBeNull()
    expect(screen.getByText('Draw Things')).not.toBeNull()
    const model = await until(() => screen.getByRole('checkbox', { name: /FLUX\.1 Dev/ }))
    expect((model as HTMLInputElement).checked).toBe(false)
    expect(localListDownloadedModels).toHaveBeenCalledOnce()
  })

  it('adds a completed background download without reopening the modal', async () => {
    await openOn('darwin')
    await until(() => screen.getByRole('checkbox', { name: /FLUX\.1 Dev/ }))
    localListDownloadedModels.mockResolvedValue([...MODELS, { ...MODELS[0], file: 'new.ckpt', name: 'New download' }])
    const onStatus = vi.mocked(window.electronAPI.onCliJobStatus).mock.calls[0][0]
    act(() => onStatus({ jobId: 'download', status: 'exited', exitCode: 0, stalled: false }))
    await until(() => screen.getByRole('checkbox', { name: 'New download' }))
    expect(localListDownloadedModels).toHaveBeenCalledTimes(2)
  })

  it('offers the scopes that cover all cloud services or all Draw Things models', async () => {
    await openOn('darwin')
    expect(screen.getByRole('radio', { name: 'All proprietary' })).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'All Draw Things' })).not.toBeNull()
  })

  it('says when no model has been downloaded', async () => {
    localListDownloadedModels.mockResolvedValue([])
    await openOn('darwin')
    await until(() => screen.getByText('No models downloaded.'))
  })
})

describe('Advanced Prompting on Windows', () => {
  it('shows only the cloud targets and never asks for Draw Things models', async () => {
    await openOn('win32')
    expect(screen.getByRole('checkbox', { name: /GPT Image/ })).not.toBeNull()
    expect(screen.queryByText('Proprietary')).toBeNull()
    expect(screen.queryByText('Draw Things')).toBeNull()
    expect(screen.queryByText('Loading models…')).toBeNull()
    expect(screen.queryByText('No models downloaded.')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /FLUX\.1 Dev/ })).toBeNull()
    expect(localListDownloadedModels).not.toHaveBeenCalled()
  })

  it('offers only the selected and all-targets scopes', async () => {
    await openOn('win32')
    expect(screen.queryByRole('radio', { name: 'All proprietary' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'All Draw Things' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Selected' })).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'All' })).not.toBeNull()
  })
})
