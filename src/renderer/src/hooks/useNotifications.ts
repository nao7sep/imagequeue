import { useEffect, useRef } from 'react'
import type { TaskStatus } from '../../../shared/types'
import { useQueue } from '../context/QueueContext'
import { useSettings } from '../context/SettingsContext'
import { useUiState } from '../context/UiStateContext'
import successUrl from '../assets/success.wav'
import failureUrl from '../assets/failure.wav'
import { serializeError } from '../../../shared/serialize-error'

// This bounds loading or stalled playback, never the duration of a sound
// that is playing. Native file-consent time belongs to the main grant owner.
export const SOUND_STALL_TIMEOUT_MS = 10_000
interface Playback { stop: () => void }

function releaseSound(url: string): void {
  void window.electronAPI.releaseAudioFile(url).catch((error) =>
    logNotificationFailure('Failed to release custom completion sound', error))
}

function playAudio(src: string, volume: number, onDone: () => void): () => void {
  const audio = new Audio(src)
  audio.volume = Math.max(0, Math.min(1, volume))
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const progress = (): void => { clearTimeout(timer); timer = undefined }
  const fail = (error: unknown): void => {
    if (disposed) return
    logNotificationFailure('Completion sound playback failed', error)
    onDone()
  }
  const stalled = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(() => fail(new Error('Completion sound playback stalled')), SOUND_STALL_TIMEOUT_MS)
  }
  const failed = (): void => fail(audio.error ?? new Error('Completion sound could not be played'))
  audio.addEventListener('ended', onDone)
  audio.addEventListener('error', failed)
  audio.addEventListener('playing', progress)
  audio.addEventListener('waiting', stalled)
  audio.addEventListener('stalled', stalled)
  stalled()
  void audio.play().catch(fail)
  return () => {
    disposed = true
    clearTimeout(timer)
    audio.removeEventListener('ended', onDone)
    audio.removeEventListener('error', failed)
    audio.removeEventListener('playing', progress)
    audio.removeEventListener('waiting', stalled)
    audio.removeEventListener('stalled', stalled)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}

function logNotificationFailure(message: string, error: unknown): void {
  void window.electronAPI.appLog('error', message, { error: serializeError(error) })
    .catch((logError) => console.error('Failed to record notification diagnostic', logError))
}

export function useNotifications(): void {
  const { tasks } = useQueue()
  const { settings } = useSettings()
  // Whether sounds play is a setting (config); how loud is an adjustment (state).
  const { uiState } = useUiState()

  // null = not yet initialized (first render); after first render holds previous statuses.
  const prevStatusesRef = useRef<Map<string, TaskStatus> | null>(null)
  const playbackRef = useRef<Playback | null>(null)
  useEffect(() => () => playbackRef.current?.stop(), [])

  useEffect(() => {
    const allTasks = Object.values(tasks).flat()

    // First render: initialize snapshot without triggering any events.
    if (prevStatusesRef.current === null) {
      const map = new Map<string, TaskStatus>()
      for (const task of allTasks) map.set(task.id, task.status)
      prevStatusesRef.current = map
      return
    }

    const prev = prevStatusesRef.current

    for (const task of allTasks) {
      const prevStatus = prev.get(task.id)
      // Restoring a kept image delivers no new generation result.
      // Queued-to-completed still counts when intermediate updates coalesce.
      if (
        prevStatus !== undefined &&
        prevStatus !== 'kept' &&
        prevStatus !== task.status &&
        (task.status === 'completed' || task.status === 'failed')
      ) {
        if (!document.hasFocus()) {
          const type = task.status === 'completed' ? 'success' : 'failure'
          triggerEvent(type, settings, uiState.notificationVolume, playbackRef)
          break // At most one event per tasks update (first match wins)
        }
      }
    }

    // Update snapshot.
    const newMap = new Map<string, TaskStatus>()
    for (const task of allTasks) newMap.set(task.id, task.status)
    prevStatusesRef.current = newMap
  }, [tasks, settings, uiState.notificationVolume])
}

function triggerEvent(
  type: 'success' | 'failure',
  settings: Record<string, unknown> | null,
  volume: number,
  playbackRef: React.MutableRefObject<Playback | null>
): void {
  const notificationCfg = (settings?.notifications ?? {}) as Record<string, unknown>
  const notificationsEnabled = (notificationCfg.notifications_enabled as boolean) ?? true
  const soundsEnabled = (notificationCfg.sounds_enabled as boolean) ?? true
  const successFile = (notificationCfg.success_file as string) ?? ''
  const failureFile = (notificationCfg.failure_file as string) ?? ''

  if (notificationsEnabled) {
    void window.electronAPI.showNotification(type)
      .catch((error) => logNotificationFailure('Failed to show completion notification', error))
  }

  if (soundsEnabled && playbackRef.current === null) {
    const customFile = type === 'success' ? successFile : failureFile
    const bundledUrl = type === 'success' ? successUrl : failureUrl
    let closed = false
    let dispose: (() => void) | undefined
    let customUrl: string | null = null
    const owner: Playback = { stop: () => {
      if (closed) return
      closed = true
      dispose?.()
      if (customUrl) releaseSound(customUrl)
      if (playbackRef.current === owner) playbackRef.current = null
    } }
    playbackRef.current = owner
    const play = (url: string): void => {
      if (closed) return
      dispose = playAudio(url, volume, owner.stop)
    }
    if (customFile) {
      void window.electronAPI.loadAudioFile(customFile).then((url) => {
        if (closed) { if (url) releaseSound(url); return }
        customUrl = url
        play(url ?? bundledUrl)
      }).catch((error) => {
        if (closed) return
        logNotificationFailure('Failed to load custom completion sound', error)
        play(bundledUrl)
      })
    } else {
      play(bundledUrl)
    }
  }
}
