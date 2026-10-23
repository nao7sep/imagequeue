// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TaskStatus } from '../../../../src/shared/types'

const state = vi.hoisted(() => ({ tasks: { openai: [] as { id: string; status: TaskStatus }[] } }))
vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({ useQueue: () => state }))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: { notifications: { notifications_enabled: true, sounds_enabled: true } } }),
}))
vi.mock('../../../../src/renderer/src/context/UiStateContext', () => ({ useUiState: () => ({ uiState: { notificationVolume: 1 } }) }))
const { useNotifications } = await import('../../../../src/renderer/src/hooks/useNotifications')

let play: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  play = vi.fn(async () => {})
  vi.stubGlobal('Audio', class { volume = 1; addEventListener = vi.fn(); play = play })
  window.electronAPI = { showNotification: vi.fn(async () => {}), appLog: vi.fn(async () => {}) } as unknown as typeof window.electronAPI
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

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
