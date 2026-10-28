import { useEffect, useRef } from 'react'
import type { TaskStatus } from '../../../shared/types'
import { useQueue } from '../context/QueueContext'
import { useSettings } from '../context/SettingsContext'
import { useUiState } from '../context/UiStateContext'
import successUrl from '../assets/success.wav'
import failureUrl from '../assets/failure.wav'
import { serializeError } from '../../../shared/serialize-error'

// One sound at a time: a new one replaces whatever is playing or loading.
interface Sound { audio: HTMLAudioElement | null }

function playAudio(src: string, volume: number): HTMLAudioElement {
  const audio = new Audio(src)
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.addEventListener('error', () =>
    logNotificationFailure('Completion sound playback failed', audio.error ?? new Error('Completion sound could not be played')))
  void audio.play().catch((error) => logNotificationFailure('Completion sound playback failed', error))
  return audio
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
  const soundRef = useRef<Sound | null>(null)
  useEffect(() => () => { soundRef.current?.audio?.pause(); soundRef.current = null }, [])

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
          triggerEvent(type, settings, uiState.notificationVolume, soundRef)
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
  soundRef: React.MutableRefObject<Sound | null>
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

  if (soundsEnabled) {
    const customFile = type === 'success' ? successFile : failureFile
    const bundledUrl = type === 'success' ? successUrl : failureUrl
    soundRef.current?.audio?.pause()
    const sound: Sound = { audio: null }
    soundRef.current = sound
    const play = (url: string): void => {
      if (soundRef.current === sound) sound.audio = playAudio(url, volume)
    }
    if (customFile) {
      void window.electronAPI.loadAudioFile(customFile).then((url) => play(url ?? bundledUrl)).catch((error) => {
        logNotificationFailure('Failed to load custom completion sound', error)
        play(bundledUrl)
      })
    } else {
      play(bundledUrl)
    }
  }
}
