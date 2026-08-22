// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  window.electronAPI = {
    hasClipboardText: vi.fn(async () => false),
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
})
