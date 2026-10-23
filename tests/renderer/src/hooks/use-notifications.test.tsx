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
const { useNotifications, SOUND_STALL_TIMEOUT_MS } = await import('../../../../src/renderer/src/hooks/useNotifications')

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
  window.electronAPI = { showNotification: vi.fn(async () => {}), appLog: vi.fn(async () => {}), loadAudioFile: vi.fn(async () => 'iq-audio://sound/fresh'), releaseAudioFile: vi.fn(async () => {}) } as unknown as typeof window.electronAPI
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


it('loads a fresh custom resource for each sound and releases it when playback finishes', async () => {
  state.notifications.success_file = '/selected.wav'
  state.tasks = { openai: [{ id: 'one', status: 'generating' }] }
  const { rerender } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'one', status: 'completed' }] }
  await act(async () => rerender())
  expect(audios[0]!.src).toBe('iq-audio://sound/fresh')
  await act(async () => audios[0]!.dispatchEvent(new Event('ended')))
  expect(audios[0]!.pause).toHaveBeenCalledOnce()
  expect(audios[0]!.removeAttribute).toHaveBeenCalledWith('src')
  expect(window.electronAPI.releaseAudioFile).toHaveBeenCalledWith('iq-audio://sound/fresh')
  state.tasks = { openai: [{ id: 'two', status: 'generating' }] }
  rerender()
  state.tasks = { openai: [{ id: 'two', status: 'completed' }] }
  await act(async () => rerender())
  expect(window.electronAPI.loadAudioFile).toHaveBeenCalledTimes(2)
  expect(audios).toHaveLength(2)
})

it('releases a stalled playback so a later completion can sound', async () => {
  vi.useFakeTimers()
  state.notifications.success_file = '/selected.wav'
  state.tasks = { openai: [{ id: 'one', status: 'generating' }] }
  const { rerender } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'one', status: 'completed' }] }
  await act(async () => rerender())
  await act(async () => vi.advanceTimersByTimeAsync(SOUND_STALL_TIMEOUT_MS))
  expect(audios[0]!.pause).toHaveBeenCalledOnce()
  expect(window.electronAPI.releaseAudioFile).toHaveBeenCalledOnce()
  state.tasks = { openai: [{ id: 'two', status: 'generating' }] }
  rerender()
  state.tasks = { openai: [{ id: 'two', status: 'completed' }] }
  await act(async () => rerender())
  expect(audios).toHaveLength(2)
})

it('does not impose a duration limit on a playing sound, but bounds a later stall', async () => {
  vi.useFakeTimers()
  state.tasks = { openai: [{ id: 'one', status: 'generating' }] }
  const { rerender } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'one', status: 'completed' }] }
  await act(async () => rerender())
  audios[0]!.dispatchEvent(new Event('playing'))
  await act(async () => vi.advanceTimersByTimeAsync(120_000))
  expect(audios[0]!.pause).not.toHaveBeenCalled()
  audios[0]!.dispatchEvent(new Event('waiting'))
  await act(async () => vi.advanceTimersByTimeAsync(SOUND_STALL_TIMEOUT_MS))
  expect(audios[0]!.pause).toHaveBeenCalledOnce()
})

it('releases a custom URL delivered after unmount without starting playback', async () => {
  state.notifications.success_file = '/selected.wav'
  let finish!: (url: string) => void
  vi.mocked(window.electronAPI.loadAudioFile).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  state.tasks = { openai: [{ id: 'one', status: 'generating' }] }
  const { rerender, unmount } = renderHook(useNotifications)
  state.tasks = { openai: [{ id: 'one', status: 'completed' }] }
  rerender()
  unmount()
  await act(async () => finish('iq-audio://sound/late'))
  expect(audios).toHaveLength(0)
  expect(window.electronAPI.releaseAudioFile).toHaveBeenCalledWith('iq-audio://sound/late')
})
