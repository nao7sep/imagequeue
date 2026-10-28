// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TaskStatus } from '../../../../src/shared/types'

const state = vi.hoisted(() => ({ tasks: { openai: [] as { id: string; status: TaskStatus }[] }, notifications: { notifications_enabled: true, sounds_enabled: true, success_file: '', failure_file: '' } }))
vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({ useQueue: () => state }))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: { notifications: state.notifications } }),
}))
vi.mock('../../../../src/renderer/src/context/UiStateContext', () => ({ useUiState: () => ({ uiState: { notificationVolume: 1 } }) }))
const { useNotifications } = await import('../../../../src/renderer/src/hooks/useNotifications')

let play: ReturnType<typeof vi.fn<() => Promise<void>>>
const audios: TestAudio[] = []
class TestAudio extends EventTarget {
  volume = 1
  error = null
  pause = vi.fn()
  removeAttribute = vi.fn()
  load = vi.fn()
  constructor(readonly src: string) { super(); audios.push(this) }
  play = () => play()
}
beforeEach(() => {
  audios.length = 0
  state.notifications.success_file = ''
  state.notifications.failure_file = ''
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  play = vi.fn(async () => {})
  vi.stubGlobal('Audio', TestAudio)
  window.electronAPI = { showNotification: vi.fn(async () => {}), appLog: vi.fn(async () => {}), loadAudioFile: vi.fn(async () => 'iq-audio://sound/fresh') } as unknown as typeof window.electronAPI
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps a restored image silent while another view has focus', () => {
  state.tasks = { openai: [{ id: 'image', status: 'kept' }] }
  const { rerender } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'image', status: 'completed' }] }
  rerender()
  expect(window.electronAPI.showNotification).not.toHaveBeenCalled()
  expect(play).not.toHaveBeenCalled()
})

it.each(['queued', 'generating'] as const)('announces new generation after %s, including coalesced updates', (status) => {
  state.tasks = { openai: [{ id: 'image', status }] }
  const { rerender } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'image', status: 'completed' }] }
  rerender()
  expect(window.electronAPI.showNotification).toHaveBeenCalledExactlyOnceWith('success')
  expect(play).toHaveBeenCalledOnce()
})

it('does not let a restored image hide a simultaneous generation failure', () => {
  state.tasks = { openai: [{ id: 'restored', status: 'kept' }, { id: 'new', status: 'generating' }] }
  const { rerender } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'restored', status: 'completed' }, { id: 'new', status: 'failed' }] }
  rerender()
  expect(window.electronAPI.showNotification).toHaveBeenCalledExactlyOnceWith('failure')
  expect(play).toHaveBeenCalledOnce()
})

it('lets a new sound replace the one still playing', async () => {
  state.notifications.success_file = '/selected.wav'
  state.tasks = { openai: [{ id: 'one', status: 'generating' }] }
  const { rerender } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'one', status: 'completed' }] }
  await act(async () => rerender())
  expect(audios[0]!.src).toBe('iq-audio://sound/fresh')
  state.tasks = { openai: [{ id: 'two', status: 'generating' }] }
  rerender()
  state.tasks = { openai: [{ id: 'two', status: 'completed' }] }
  await act(async () => rerender())
  expect(audios[0]!.pause).toHaveBeenCalledOnce()
  expect(audios).toHaveLength(2)
  expect(window.electronAPI.loadAudioFile).toHaveBeenCalledTimes(2)
})
