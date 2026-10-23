// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushModal, popModal } from '../../../../src/renderer/src/components/modalStack'
import type { Task } from '../../../../src/shared/types'

vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: { notifications: { notifications_enabled: true, sounds_enabled: true } },
    saveNotificationField: vi.fn(),
  }),
}))
vi.mock('../../../../src/renderer/src/context/UiStateContext', () => ({
  useUiState: () => ({ uiState: { notificationVolume: 1 }, patchUiState: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/context/EnqueueConfigContext', () => ({
  useEnqueueConfigs: () => ({ enqueueToBackend: vi.fn(), enqueueToAll: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/hooks/useVisiblePanes', () => ({
  useVisiblePanes: () => ({ backends: ['openai'] }),
}))
vi.mock('../../../../src/renderer/src/components/AdvancedPromptingModal', () => ({
  AdvancedPromptingModal: () => null,
}))
vi.mock('../../../../src/renderer/src/components/NotificationVolumeSlider', () => ({
  NotificationVolumeSlider: () => null,
}))
const selection = vi.hoisted(() => ({
  reportTaskActionFailure: vi.fn(),
  clearTaskActionResult: vi.fn(),
}))
vi.mock('../../../../src/renderer/src/context/SelectionContext', () => ({
  useSelection: () => selection,
}))

const { PromptPane } = await import('../../../../src/renderer/src/components/PromptPane')

const selectedTask: Task = {
  id: 'task-1',
  prompt: 'a cat',
  backend: 'openai',
  model: 'gpt-image-2',
  params: {
    width: 1024,
    height: 768,
    outputFormat: 'png',
    negativePrompt: 'blur',
    personGeneration: 'allow',
    aspectRatio: '4:3',
    imageSize: '1K',
  },
  status: 'interrupted',
  enqueuedAt: '2026-08-23T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  durationMs: 1500,
  imagePath: null,
  baseName: null,
  error: null,
  providerMessage: null,
}

const completedTask: Task = {
  ...selectedTask,
  status: 'completed',
  imagePath: '/session/image.png',
  baseName: 'image',
}

let appLog: ReturnType<typeof vi.fn>
let clipboardWriteText: ReturnType<typeof vi.fn>

let decode: ReturnType<typeof vi.fn>

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  selection.reportTaskActionFailure.mockClear()
  selection.clearTaskActionResult.mockClear()
  // jsdom loads no images; the preview decodes before it draws.
  decode = vi.fn(async () => undefined)
  HTMLImageElement.prototype.decode = decode as unknown as () => Promise<void>
  appLog = vi.fn(async () => undefined)
  clipboardWriteText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  })
  window.electronAPI = {
    onWindowCommand: vi.fn(() => () => undefined),
    hasClipboardText: vi.fn(async () => false),
    readClipboardText: vi.fn(async () => 'clipboard prompt'),
    revealFile: vi.fn(async () => undefined),
    copyImageToClipboard: vi.fn(async () => undefined),
    exportImage: vi.fn(async () => '/exports/image.png'),
    exportImageAs: vi.fn(async () => '/exports/image.png'),
    appLog,
  } as unknown as typeof window.electronAPI
})

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); popModal('clipboard-test') })

describe('PromptPane presentation', () => {
  it('draws a completed task\'s image from the app\'s image scheme once it has decoded, and clears an earlier load failure', async () => {
    let finishDecode!: () => void
    decode.mockImplementationOnce(() => new Promise<void>((resolve) => { finishDecode = resolve }))
    const { container } = render(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={vi.fn()} />)
    expect(container.querySelector('.preview-image')).toBeNull()
    // Settle the boundary this test owns directly: no polling deadline races
    // a delayed React flush when several renderer files are running together.
    await act(async () => finishDecode())
    expect(container.querySelector('.preview-image')).not.toBeNull()
    expect(container.querySelector('.preview-image')?.getAttribute('src')).toBe('iq-image://sessions/current/image')
    expect(selection.clearTaskActionResult).toHaveBeenCalledWith('task-1', 'preview')
    expect(selection.reportTaskActionFailure).not.toHaveBeenCalled()
  })

  it('puts the load-failure note on the task when its image cannot load, missing or unreadable alike', async () => {
    let failDecode!: (error: Error) => void
    decode.mockImplementationOnce(() => new Promise<void>((_, reject) => { failDecode = reject }))
    const { container } = render(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={vi.fn()} />)
    await act(async () => failDecode(new Error('EncodingError')))
    expect(selection.reportTaskActionFailure).toHaveBeenCalledOnce()
    expect(selection.reportTaskActionFailure).toHaveBeenCalledWith('task-1', 'preview', 'task.previewFailed', 'Failed to load selected image', expect.any(Error))
    expect(container.querySelector('.preview-image')).toBeNull()
    // It says the image did not load, never that nothing is selected.
    expect(container.querySelector('.preview-placeholder')?.textContent).toBe('This image could not be loaded.')
  })

  it('shows loading while a selected image is decoding', () => {
    decode.mockImplementationOnce(() => new Promise<void>(() => {}))
    const { container } = render(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={vi.fn()} />)
    expect(container.querySelector('.preview-loading')?.textContent).toBe('Loading…')
  })

  it('keeps the usual placeholder for a selected task that has no image', () => {
    const { container } = render(<PromptPane selectedTask={selectedTask} prompt="" onPromptChange={vi.fn()} />)
    expect(container.querySelector('.preview-placeholder')?.textContent).toContain('No image selected')
  })

  it('shows a failed task\'s whole reason in its own strip under the preview: the authored lead-in, then the provider\'s words', () => {
    const said = 'Your request was rejected by the safety system. '.repeat(8).trim()
    const failedTask: Task = {
      ...selectedTask,
      status: 'failed',
      error: { key: 'taskFailure.refusedWithReason', values: { name: 'OpenAI', reason: 'moderation_blocked' } },
      providerMessage: said,
    }
    const { container } = render(
      <PromptPane selectedTask={failedTask} prompt="" onPromptChange={vi.fn()} />
    )
    const failure = container.querySelector('.preview-failure') as HTMLElement
    expect(failure.textContent).toContain('OpenAI refused this prompt (“moderation_blocked”)')
    expect(failure.querySelector('.preview-failure-provider')?.textContent).toBe(said)
    // The strip follows the preview, which keeps its placeholder.
    expect(container.querySelector('.preview-area .preview-failure')).toBeNull()
    expect(container.querySelector('.preview-area')?.nextElementSibling).toBe(failure)
    expect(container.querySelector('.preview-area .preview-placeholder')).not.toBeNull()
  })

  it('shows no failure strip for a task that has not failed', () => {
    const { container } = render(
      <PromptPane selectedTask={selectedTask} prompt="" onPromptChange={vi.fn()} />
    )
    expect(container.querySelector('.preview-failure')).toBeNull()
  })

  it('shows the lead-in alone when the provider said nothing', () => {
    const failedTask: Task = { ...selectedTask, status: 'failed', error: { key: 'taskFailure.generic', values: { name: 'OpenAI' } } }
    const { container } = render(
      <PromptPane selectedTask={failedTask} prompt="" onPromptChange={vi.fn()} />
    )
    expect(container.querySelector('.preview-failure')?.textContent).toContain('OpenAI could not generate this image')
    expect(container.querySelector('.preview-failure-provider')).toBeNull()
  })


  it('retains the metadata toggle and keyboard focus across expansion and collapse', () => {
    const { container } = render(<PromptPane selectedTask={selectedTask} prompt="" onPromptChange={vi.fn()} />)
    const toggle = container.querySelector<HTMLButtonElement>('.metadata-toggle')!
    toggle.focus()
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Native button keyboard activation dispatches click; jsdom does not synthesize it.
    fireEvent.click(toggle, { detail: 0 })
    expect(container.querySelector('.metadata-toggle')).toBe(toggle)
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const details = screen.getByRole('region', { name: 'Task details' })
    expect(toggle.getAttribute('aria-controls')).toBe(details.id)
    expect(details.tabIndex).toBe(0)
    details.focus()
    fireEvent.click(details)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.focus()
    fireEvent.click(toggle, { detail: 0 })
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('keeps A visible and image actions disabled until B has decoded, while prompt copy remains usable', async () => {
    const change = vi.fn()
    const { container, rerender } = render(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={change} />)
    await act(async () => {})
    let finish!: () => void
    decode.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const next = { ...completedTask, id: 'B', baseName: 'image-b', prompt: 'B prompt' }
    rerender(<PromptPane selectedTask={next} prompt="" onPromptChange={change} />)
    expect(container.querySelector('.preview-image')?.getAttribute('src')).toBe('iq-image://sessions/current/image')
    expect(screen.getByText('Loading…')).toBeTruthy()
    const names = ['Reveal', 'Copy to Clipboard', 'Export', 'Save As']
    for (const name of names) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
    }
    expect(window.electronAPI.revealFile).not.toHaveBeenCalled()
    expect(window.electronAPI.copyImageToClipboard).not.toHaveBeenCalled()
    expect(window.electronAPI.exportImage).not.toHaveBeenCalled()
    expect(window.electronAPI.exportImageAs).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }))
    expect(clipboardWriteText).toHaveBeenCalledWith('B prompt')
    await act(async () => finish())
    expect(container.querySelector('.preview-image')?.getAttribute('src')).toBe('iq-image://sessions/current/image-b')
    expect(screen.queryByText('Loading…')).toBeNull()
    for (const name of names) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      fireEvent.click(button)
    }
    for (const method of ['revealFile', 'copyImageToClipboard', 'exportImage', 'exportImageAs'] as const) {
      expect(window.electronAPI[method]).toHaveBeenCalledWith('image-b', 'png')
    }
    await act(async () => {})
  })

  it('does not enable image actions for a stale decode or a failed current image', async () => {
    let finishOld!: () => void
    let failCurrent!: (error: Error) => void
    decode.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOld = resolve }))
    const change = vi.fn()
    const { container, rerender } = render(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={change} />)
    decode.mockImplementationOnce(() => new Promise<void>((_, reject) => { failCurrent = reject }))
    rerender(<PromptPane selectedTask={{ ...completedTask, id: 'B', baseName: 'image-b' }} prompt="" onPromptChange={change} />)
    await act(async () => finishOld())
    expect(container.querySelector('.preview-image')).toBeNull()
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => failCurrent(new Error('decode failed')))
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('This image could not be loaded.')).toBeTruthy()
    for (const name of ['Reveal', 'Copy to Clipboard', 'Export', 'Save As']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('renders metadata, parameter, and task-state labels in sentence case', () => {
    const { container } = render(
      <PromptPane
        selectedTask={selectedTask}
        prompt="a cat"
        onPromptChange={vi.fn()}
      />
    )

    fireEvent.click(container.querySelector('.metadata-toggle') as HTMLButtonElement)

    expect(screen.getByText('Interrupted')).toBeTruthy()
    expect(Array.from(container.querySelectorAll('.preview-metadata strong')).map((node) => node.textContent)).toEqual([
      'Model:',
      'Status:',
      'Prompt:',
      'Time:',
      'Size:',
      'Format:',
      'Negative:',
      'Persons:',
      'Aspect:',
      'Image size:',
    ])
  })

  it('retains a clipboard-read failure beside Paste Text until retry succeeds', async () => {
    const readClipboardText = vi.fn()
      .mockRejectedValueOnce(new Error('clipboard denied'))
      .mockResolvedValueOnce('recovered prompt')
    window.electronAPI.readClipboardText = readClipboardText
    window.electronAPI.hasClipboardText = vi.fn(async () => true)
    const onPromptChange = vi.fn()
    render(
      <PromptPane
        selectedTask={null}
        prompt=""
        onPromptChange={onPromptChange}
      />
    )

    const paste = await screen.findByRole('button', { name: 'Paste Text' })
    await waitFor(() => expect(paste.hasAttribute('disabled')).toBe(false))
    fireEvent.click(paste)

    expect((await screen.findByRole('alert')).textContent).toContain('The clipboard text could not be read')
    expect(appLog).toHaveBeenCalledWith(
      'error',
      'Prompt pane action failed',
      expect.objectContaining({ action: 'paste-text' }),
    )

    fireEvent.click(paste)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(onPromptChange).toHaveBeenCalledWith('recovered prompt')
  })

  it('keeps independently keyed preview failures until matching recovery or dismissal', async () => {
    const revealFile = vi.fn()
      .mockRejectedValueOnce(new Error('missing file'))
      .mockResolvedValueOnce(undefined)
    const exportImage = vi.fn(async () => '/exports/image.png')
    window.electronAPI.revealFile = revealFile
    window.electronAPI.exportImage = exportImage
    render(
      <PromptPane
        selectedTask={completedTask}
        prompt="a cat"
        onPromptChange={vi.fn()}
      />
    )

    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The image could not be revealed')

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(exportImage).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('alert').textContent).toContain('The image could not be revealed')

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    window.electronAPI.copyImageToClipboard = vi.fn(async () => {
      throw new Error('clipboard image denied')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy to Clipboard' }))
    const copyFailure = await screen.findByRole('alert')
    expect(copyFailure.textContent).toContain('The image could not be copied')
    fireEvent.click(screen.getByRole('button', { name: /Close result: The image could not be copied/ }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces prompt-copy and both export command failures with diagnostic context', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    window.electronAPI.exportImage = vi.fn(async () => { throw new Error('export locked') })
    window.electronAPI.exportImageAs = vi.fn(async () => { throw new Error('save locked') })
    render(
      <PromptPane
        selectedTask={completedTask}
        prompt="a cat"
        onPromptChange={vi.fn()}
      />
    )

    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }))

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3))
    expect(screen.getByText(/The prompt could not be copied/)).toBeTruthy()
    expect(screen.getByText(/The image could not be exported/)).toBeTruthy()
    expect(screen.getByText(/The image could not be saved/)).toBeTruthy()
    expect(appLog.mock.calls.map((call) => call[2]?.action)).toEqual(expect.arrayContaining([
      'copy-prompt',
      'export-image',
      'save-image-as',
    ]))
  })
})


describe('export selection ownership', () => {
  it.each(['exportImage', 'exportImageAs'] as const)('does not apply a late %s failure after A/B/A selection', async (method) => {
    let reject!: (error: Error) => void
    window.electronAPI[method] = vi.fn(() => new Promise<string>((_resolve, rejectPromise) => { reject = rejectPromise }))
    const change = vi.fn()
    const { rerender } = render(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={change} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: method === 'exportImage' ? 'Export' : 'Save As' }))
    rerender(<PromptPane selectedTask={{ ...completedTask, id: 'B' }} prompt="" onPromptChange={change} />)
    rerender(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={change} />)
    await act(async () => { reject(new Error('late export failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not show late export success after A/B/A selection', async () => {
    let resolve!: (destination: string) => void
    window.electronAPI.exportImage = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    const change = vi.fn()
    const { rerender } = render(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={change} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    rerender(<PromptPane selectedTask={{ ...completedTask, id: 'B' }} prompt="" onPromptChange={change} />)
    rerender(<PromptPane selectedTask={completedTask} prompt="" onPromptChange={change} />)
    await act(async () => { resolve('/exports/image.png') })
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })
})


it('polls clipboard availability only while usable and refreshes on return', async () => {
  vi.useFakeTimers()
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const probe = vi.mocked(window.electronAPI.hasClipboardText)
  const view = render(<PromptPane selectedTask={null} prompt="" onPromptChange={vi.fn()} />)
  await act(async () => {})
  expect(probe).toHaveBeenCalledTimes(1)
  focused.mockReturnValue(false)
  await act(async () => { vi.advanceTimersByTime(5000) })
  expect(probe).toHaveBeenCalledTimes(1)
  focused.mockReturnValue(true)
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(probe).toHaveBeenCalledTimes(2)
  visibility.mockReturnValue('hidden')
  await act(async () => { vi.advanceTimersByTime(5000) })
  expect(probe).toHaveBeenCalledTimes(2)
  visibility.mockReturnValue('visible')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(probe).toHaveBeenCalledTimes(3)
  act(() => pushModal('clipboard-test'))
  await act(async () => { vi.advanceTimersByTime(5000); window.dispatchEvent(new Event('focus')) })
  expect(probe).toHaveBeenCalledTimes(3)
  await act(async () => { popModal('clipboard-test') })
  expect(probe).toHaveBeenCalledTimes(4)
  view.unmount()
  await act(async () => { vi.advanceTimersByTime(5000); window.dispatchEvent(new Event('focus')) })
  expect(probe).toHaveBeenCalledTimes(4)
})
