// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
}

const completedTask: Task = {
  ...selectedTask,
  status: 'completed',
  imagePath: '/session/image.png',
  baseName: 'image',
}

let appLog: ReturnType<typeof vi.fn>
let clipboardWriteText: ReturnType<typeof vi.fn>

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  appLog = vi.fn(async () => undefined)
  clipboardWriteText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  })
  window.electronAPI = {
    hasClipboardText: vi.fn(async () => false),
    readClipboardText: vi.fn(async () => 'clipboard prompt'),
    revealFile: vi.fn(async () => undefined),
    copyImageToClipboard: vi.fn(async () => undefined),
    exportImage: vi.fn(async () => '/exports/image.png'),
    exportImageAs: vi.fn(async () => '/exports/image.png'),
    appLog,
  } as unknown as typeof window.electronAPI
})

afterEach(cleanup)

describe('PromptPane presentation', () => {
  it('renders metadata, parameter, and task-state labels in sentence case', () => {
    const { container } = render(
      <PromptPane
        selectedTask={selectedTask}
        previewDataUrl={null}
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
        previewDataUrl={null}
        prompt=""
        onPromptChange={onPromptChange}
      />
    )

    const paste = await screen.findByRole('button', { name: 'Paste Text' })
    await waitFor(() => expect(paste.hasAttribute('disabled')).toBe(false))
    fireEvent.click(paste)

    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t read text from the clipboard')
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
        previewDataUrl="data:image/png;base64,AA=="
        prompt="a cat"
        onPromptChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t reveal this image')

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(exportImage).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t reveal this image')

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    window.electronAPI.copyImageToClipboard = vi.fn(async () => {
      throw new Error('clipboard image denied')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy to Clipboard' }))
    const copyFailure = await screen.findByRole('alert')
    expect(copyFailure.textContent).toContain('Couldn’t copy this image')
    fireEvent.click(screen.getByRole('button', { name: /Close result: Couldn’t copy this image/ }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces prompt-copy and both export command failures with diagnostic context', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    window.electronAPI.exportImage = vi.fn(async () => { throw new Error('export locked') })
    window.electronAPI.exportImageAs = vi.fn(async () => { throw new Error('save locked') })
    render(
      <PromptPane
        selectedTask={completedTask}
        previewDataUrl="data:image/png;base64,AA=="
        prompt="a cat"
        onPromptChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }))

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3))
    expect(screen.getByText(/Couldn’t copy the prompt/)).toBeTruthy()
    expect(screen.getByText(/Couldn’t export this image/)).toBeTruthy()
    expect(screen.getByText(/Couldn’t save this image/)).toBeTruthy()
    expect(appLog.mock.calls.map((call) => call[2]?.action)).toEqual(expect.arrayContaining([
      'copy-prompt',
      'export-image',
      'save-image-as',
    ]))
  })
})
