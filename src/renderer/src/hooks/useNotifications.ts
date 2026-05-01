import { useEffect, useRef } from 'react'
import type { TaskStatus } from '../../../shared/types'
import { useQueue } from '../context/QueueContext'
import { useSettings } from '../context/SettingsContext'
import successUrl from '../assets/success.wav'
import failureUrl from '../assets/failure.wav'

// Cache loaded audio data URLs by file path.
const audioCache: Record<string, string | null> = {}

async function loadAudioFile(filePath: string): Promise<string | null> {
  if (filePath in audioCache) return audioCache[filePath]
  const dataUrl = await window.electronAPI.loadAudioFile(filePath)
  audioCache[filePath] = dataUrl
  return dataUrl
}

function playAudio(src: string, volume: number, onDone: () => void): void {
  const audio = new Audio(src)
  audio.volume = Math.max(0, Math.min(1, volume))
  audio.addEventListener('ended', onDone)
  audio.addEventListener('error', onDone)
  void audio.play().catch(onDone)
}

export function useNotifications(): void {
  const { tasks } = useQueue()
  const { settings } = useSettings()

  // null = not yet initialized (first render); after first render holds previous statuses.
  const prevStatusesRef = useRef<Map<string, TaskStatus> | null>(null)
  const isPlayingRef = useRef(false)

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
      // Only fire for explicit status transitions of existing tasks.
      if (
        prevStatus !== undefined &&
        prevStatus !== task.status &&
        (task.status === 'completed' || task.status === 'failed')
      ) {
        if (!document.hasFocus()) {
          const type = task.status === 'completed' ? 'success' : 'failure'
          triggerEvent(type, settings, isPlayingRef)
          break // At most one event per tasks update (first match wins)
        }
      }
    }

    // Update snapshot.
    const newMap = new Map<string, TaskStatus>()
    for (const task of allTasks) newMap.set(task.id, task.status)
    prevStatusesRef.current = newMap
  }, [tasks, settings])
}

function triggerEvent(
  type: 'success' | 'failure',
  settings: Record<string, unknown> | null,
  isPlayingRef: React.MutableRefObject<boolean>
): void {
  const notificationCfg = (settings?.notifications ?? {}) as Record<string, unknown>
  const notificationsEnabled = (notificationCfg.notifications_enabled as boolean) ?? true
  const soundsEnabled = (notificationCfg.sounds_enabled as boolean) ?? true
  const volume = (notificationCfg.volume as number) ?? 0.7
  const successFile = (notificationCfg.success_file as string) ?? ''
  const failureFile = (notificationCfg.failure_file as string) ?? ''

  if (notificationsEnabled) {
    void window.electronAPI.showNotification(type)
  }

  if (soundsEnabled && !isPlayingRef.current) {
    isPlayingRef.current = true
    const customFile = type === 'success' ? successFile : failureFile
    const bundledUrl = type === 'success' ? successUrl : failureUrl
    const done = (): void => { isPlayingRef.current = false }

    if (customFile) {
      void loadAudioFile(customFile).then((dataUrl) => {
        playAudio(dataUrl ?? bundledUrl, volume, done)
      })
    } else {
      playAudio(bundledUrl, volume, done)
    }
  }
}

