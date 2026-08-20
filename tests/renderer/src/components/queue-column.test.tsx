// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import type { BackendId, CliStatus, DrawThingsModelParams, LocalModelInfo, Task } from '../../../../src/shared/types'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../../../src/shared/types'
import { getDefaultModelForBackend } from '../../../../src/shared/models'

// The column under test drives everything through four contexts plus
// window.electronAPI. The contexts are mocked with mutable module-level values
// so each test can stage settings/tasks; electronAPI is a per-test stub. This
// exercises the real QueueColumn + descriptor Controls + useDrawThingsColumn
// wiring in a real DOM — everything short of the Electron main process.

const emptyTasks = (): Record<BackendId, Task[]> => ({
  openai: [], nanobanana: [], grok: [], flux: [], drawthings: [],
})

let settingsValue: {
  settings: Record<string, unknown> | null
  apiKeyPresence: { image: Record<string, boolean>; geminiText: boolean; openaiText: boolean } | null
  saveChangedSettings: ReturnType<typeof vi.fn>
  saveBrainstormSettings: ReturnType<typeof vi.fn>
  saveImageBackendDefaults: ReturnType<typeof vi.fn>
  saveNotificationField: ReturnType<typeof vi.fn>
}
let queueValue: { tasks: Record<BackendId, Task[]> } & Record<string, unknown>
let selectionValue: Record<string, unknown>
let enqueueValue: { snapshots: Record<string, unknown>; setSnapshot: ReturnType<typeof vi.fn>; enqueueToBackend: ReturnType<typeof vi.fn>; enqueueToAll: ReturnType<typeof vi.fn> }

vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => settingsValue,
}))
vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({
  useQueue: () => queueValue,
}))
vi.mock('../../../../src/renderer/src/context/SelectionContext', () => ({
  useSelection: () => selectionValue,
}))
vi.mock('../../../../src/renderer/src/context/EnqueueConfigContext', () => ({
  useEnqueueConfigs: () => enqueueValue,
}))
// Pointer and modal reach further into electronAPI/dependency state than these
// tests need; both are inert stand-ins.
vi.mock('../../../../src/renderer/src/components/DependencyPanePointer', () => ({
  DependencyPanePointer: () => null,
}))
vi.mock('../../../../src/renderer/src/components/DrawThingsModelsModal', () => ({
  DrawThingsModelsModal: () => null,
}))

const { QueueColumn } = await import('../../../../src/renderer/src/components/QueueColumn')

interface ElectronApiStub {
  appLog: ReturnType<typeof vi.fn>
  localCheckCli: ReturnType<typeof vi.fn>
  localListDownloadedModels: ReturnType<typeof vi.fn>
  dtGetAllModelParams: ReturnType<typeof vi.fn>
  dtGetModelParams: ReturnType<typeof vi.fn>
  dtApplyParamsToAllModels: ReturnType<typeof vi.fn>
  dtSaveModelParams: ReturnType<typeof vi.fn>
  resolveRecommendation: ReturnType<typeof vi.fn>
  onCliJobStatus: ReturnType<typeof vi.fn>
  getImage: ReturnType<typeof vi.fn>
}
let electronAPI: ElectronApiStub

const CLI_OK: CliStatus = { installed: true, version: '1.0.0', path: '/usr/local/bin/drawthings', platform: 'darwin' }
const CLI_MISSING: CliStatus = { installed: false, version: null, path: null, platform: 'darwin' }
const MODEL_A: LocalModelInfo = { file: 'model-a.ckpt', name: 'Model A', source: 'official', downloaded: true, huggingFace: null }
const MODEL_B: LocalModelInfo = { file: 'model-b.ckpt', name: 'Model B', source: 'official', downloaded: true, huggingFace: null }
const SAVED_DT_PARAMS: DrawThingsModelParams = { width: 768, height: 512, steps: 8, guidance: 3, seed: '42', negativePrompt: 'blurry' }

beforeEach(() => {
  settingsValue = {
    settings: null,
    apiKeyPresence: null,
    saveChangedSettings: vi.fn(async () => ({})),
    saveBrainstormSettings: vi.fn(async () => ({})),
    saveImageBackendDefaults: vi.fn(async () => ({})),
    saveNotificationField: vi.fn(async () => ({})),
  }
  queueValue = {
    tasks: emptyTasks(),
    showKeptImages: false,
    toggleShowKeptImages: vi.fn(),
    enqueue: vi.fn(),
    removeTask: vi.fn(),
    restoreTask: vi.fn(),
  }
  selectionValue = {
    selection: null,
    selectedTask: null,
    select: vi.fn(),
    clear: vi.fn(),
    navigate: vi.fn(),
    selectEdge: vi.fn(),
    removeTask: vi.fn(),
    restoreTask: vi.fn(),
    deleteTask: vi.fn(),
    removeSelected: vi.fn(),
    restoreSelected: vi.fn(),
    deleteSelected: vi.fn(),
  }
  enqueueValue = {
    snapshots: {},
    setSnapshot: vi.fn(),
    enqueueToBackend: vi.fn(),
    enqueueToAll: vi.fn(),
  }
  electronAPI = {
    appLog: vi.fn(async () => undefined),
    localCheckCli: vi.fn(async () => CLI_MISSING),
    localListDownloadedModels: vi.fn(async () => []),
    dtGetAllModelParams: vi.fn(async () => ({})),
    dtGetModelParams: vi.fn(async () => null),
    dtApplyParamsToAllModels: vi.fn(async () => undefined),
    dtSaveModelParams: vi.fn(async () => undefined),
    resolveRecommendation: vi.fn(async () => null),
    onCliJobStatus: vi.fn(() => () => undefined),
    getImage: vi.fn(async () => null),
  }
  ;(window as unknown as { electronAPI: ElectronApiStub }).electronAPI = electronAPI
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function stageSettings(backend: string, model: string, defaultParams: Record<string, unknown> = {}): void {
  settingsValue.settings = {
    image_backends: {
      [backend]: { model, default_params: defaultParams },
    },
  }
}

/** The control (select/input) beside the given row label. */
function rowControl(container: HTMLElement, label: string): HTMLSelectElement | HTMLInputElement {
  const row = Array.from(container.querySelectorAll('.setting-row')).find(
    (r) => r.querySelector('label')?.textContent === label
  )
  const control = row?.querySelector('select, input')
  expect(control, `control for row "${label}"`).toBeTruthy()
  return control as HTMLSelectElement | HTMLInputElement
}

async function flush(): Promise<void> {
  await act(async () => {})
}

async function advanceAutosave(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(900)
  })
}

describe('cloud columns: saved defaults at launch', () => {
  it.each(CLOUD_BACKEND_IDS_IN_UI_ORDER)(
    '%s applies saved defaults without a spurious settings write',
    async (backend) => {
      vi.useFakeTimers()
      const model = getDefaultModelForBackend(backend)!.id
      stageSettings(backend, model)
      const { container } = render(<QueueColumn backendId={backend} label={backend} prompt="a cat" />)
      await flush()
      expect((rowControl(container, 'model') as HTMLSelectElement).value).toBe(model)
      // The launch-time apply must round-trip to an identical snapshot: before
      // the descriptors, FLUX's resolver used a different params key order and
      // this exact wait produced one settings write per launch.
      await advanceAutosave()
      expect(settingsValue.saveImageBackendDefaults).not.toHaveBeenCalled()
    }
  )
})

describe('openai column', () => {
  it('autosaves the enqueue-shaped params once after an edit', async () => {
    vi.useFakeTimers()
    stageSettings('openai', 'gpt-image-2')
    const { container } = render(<QueueColumn backendId="openai" label="GPT Image" prompt="a cat" />)
    await flush()

    fireEvent.change(rowControl(container, 'quality'), { target: { value: 'high' } })
    await advanceAutosave()

    expect(settingsValue.saveImageBackendDefaults).toHaveBeenCalledTimes(1)
    expect(settingsValue.saveImageBackendDefaults).toHaveBeenCalledWith('openai', 'gpt-image-2', {
      width: 1024,
      height: 1024,
      moderation: 'auto',
      quality: 'high',
      outputFormat: 'png',
      background: 'opaque',
    })
  })

  it('clamps a background the newly selected model does not offer', async () => {
    vi.useFakeTimers()
    // gpt-image-1 offers 'transparent'; gpt-image-2 does not.
    stageSettings('openai', 'gpt-image-1.5', { background: 'transparent' })
    const { container } = render(<QueueColumn backendId="openai" label="GPT Image" prompt="a cat" />)
    await flush()
    expect((rowControl(container, 'background') as HTMLSelectElement).value).toBe('transparent')

    fireEvent.change(rowControl(container, 'model'), { target: { value: 'gpt-image-2' } })
    await flush()
    expect((rowControl(container, 'background') as HTMLSelectElement).value).toBe('opaque')
  })

  it('shows custom width/height inputs only for a model that supports them', async () => {
    stageSettings('openai', 'gpt-image-2')
    const { container } = render(<QueueColumn backendId="openai" label="GPT Image" prompt="a cat" />)
    await flush()
    expect(rowControl(container, 'width')).toBeTruthy()

    fireEvent.change(rowControl(container, 'model'), { target: { value: 'gpt-image-1.5' } })
    await flush()
    const widthRow = Array.from(container.querySelectorAll('.setting-row')).find(
      (r) => r.querySelector('label')?.textContent === 'width'
    )
    expect(widthRow).toBeUndefined()
  })
})

describe('flux column', () => {
  it('shows steps/guidance only for the model that declares the ranges', async () => {
    stageSettings('flux', 'flux-2-pro')
    const { container } = render(<QueueColumn backendId="flux" label="FLUX" prompt="a cat" />)
    await flush()
    const labels = Array.from(container.querySelectorAll('.setting-row label')).map((l) => l.textContent)
    expect(labels).not.toContain('steps')
    expect(labels).not.toContain('guidance')
    expect(labels).toContain('seed')

    fireEvent.change(rowControl(container, 'model'), { target: { value: 'flux-2-flex' } })
    await flush()
    expect(rowControl(container, 'steps')).toBeTruthy()
    expect(rowControl(container, 'guidance')).toBeTruthy()
  })
})

describe('snapshot wiring', () => {
  it('publishes model, params, and readiness for Send-to-All', async () => {
    stageSettings('grok', 'grok-2-image')
    render(<QueueColumn backendId="grok" label="Grok" prompt="a cat" />)
    await flush()
    const model = getDefaultModelForBackend('grok')!.id
    const calls = enqueueValue.setSnapshot.mock.calls.filter(([, snap]) => snap !== null)
    const last = calls[calls.length - 1]
    expect(last[0]).toBe('grok')
    expect(last[1]).toMatchObject({ model, ready: true })
    expect(last[1].params).toHaveProperty('aspectRatio')
    expect(last[1].params).toHaveProperty('resolution')
  })
})

describe('drawthings column', () => {
  it('is not ready with the CLI missing', async () => {
    const { container } = render(<QueueColumn backendId="drawthings" label="Draw Things" prompt="a cat" />)
    await flush()
    const queueButton = container.querySelector('.enqueue-btn') as HTMLButtonElement
    expect(queueButton.disabled).toBe(true)
  })

  it('shows the no-models state with the CLI installed but nothing downloaded', async () => {
    electronAPI.localCheckCli.mockResolvedValue(CLI_OK)
    const { container } = render(<QueueColumn backendId="drawthings" label="Draw Things" prompt="a cat" />)
    await flush()
    expect(container.textContent).toContain('No models downloaded yet')
    expect((container.querySelector('.enqueue-btn') as HTMLButtonElement).disabled).toBe(true)
  })

  it('loads a model list, applies saved per-model params, and autosaves an edit', async () => {
    electronAPI.localCheckCli.mockResolvedValue(CLI_OK)
    electronAPI.localListDownloadedModels.mockResolvedValue([MODEL_A, MODEL_B])
    electronAPI.dtGetModelParams.mockResolvedValue(SAVED_DT_PARAMS)
    const { container } = render(<QueueColumn backendId="drawthings" label="Draw Things" prompt="a cat" />)
    await flush()
    await flush()

    const modelSelect = rowControl(container, 'model') as HTMLSelectElement
    expect(Array.from(modelSelect.options).map((o) => o.textContent)).toEqual(['Model A', 'Model B'])
    expect((rowControl(container, 'width') as HTMLInputElement).value).toBe('768')
    expect((rowControl(container, 'seed') as HTMLInputElement).value).toBe('42')

    // The loadedModel gate is open (the saved params landed), so an edit
    // persists under this model's key.
    fireEvent.change(rowControl(container, 'width'), { target: { value: '1024' } })
    await flush()
    expect(electronAPI.dtSaveModelParams).toHaveBeenCalledWith(
      'model-a.ckpt',
      { ...SAVED_DT_PARAMS, width: 1024 }
    )
    expect((container.querySelector('.enqueue-btn') as HTMLButtonElement).disabled).toBe(false)
  })
})


// The env-only-key bug, at the surface the user meets: the column's warning and
// its + Queue button must follow the presence signal. Settings carries no key at
// all now — keys travel their own channel — so presence is the ONLY thing that
// can answer "can this backend be called", and these pin that it is consulted.
describe('API key warning follows presence, not the stored settings value', () => {
  const presence = (openai: boolean): typeof settingsValue.apiKeyPresence => ({
    image: { openai, nanobanana: false, grok: false, flux: false },
    geminiText: false,
    openaiText: false,
  })

  // An env-supplied key: nothing in settings says so, presence says yes.
  it('shows no warning and enables + Queue for an environment-only key', () => {
    settingsValue.settings = { image_backends: { openai: {} } }
    settingsValue.apiKeyPresence = presence(true)
    render(<QueueColumn backendId="openai" label="GPT Image" prompt="a cat" />)
    expect(screen.queryByText('API key not set')).toBeNull()
    expect(screen.getByRole('button', { name: 'Queue' }).hasAttribute('disabled')).toBe(false)
  })

  it('warns and disables + Queue when no key resolves', () => {
    settingsValue.settings = { image_backends: { openai: {} } }
    settingsValue.apiKeyPresence = presence(false)
    render(<QueueColumn backendId="openai" label="GPT Image" prompt="a cat" />)
    expect(screen.getByText('API key not set')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Queue' }).hasAttribute('disabled')).toBe(true)
  })

  // Startup: presence is null for a moment. A column must not flash
  // "API key not set" before the answer arrives.
  it('does not warn while presence is still loading', () => {
    settingsValue.settings = { image_backends: { openai: {} } }
    settingsValue.apiKeyPresence = null
    render(<QueueColumn backendId="openai" label="GPT Image" prompt="a cat" />)
    expect(screen.queryByText('API key not set')).toBeNull()
  })
})
