import { useEffect, useRef } from 'react'
import type { CloudBackendId } from '../../../shared/types'
import {
  serializeImageBackendDefaults,
  type SavedImageBackendDefaults,
} from '../utils/imageBackendDefaults'

interface UseAutosavedImageBackendDefaultsOptions {
  backend: CloudBackendId | null
  settingsLoaded: boolean
  saved: SavedImageBackendDefaults | null
  currentModel: string
  currentParams: Record<string, unknown>
  applySaved: (saved: SavedImageBackendDefaults) => void
  saveDefaults: (backend: CloudBackendId, model: string, params: Record<string, unknown>) => Promise<unknown>
}

export function useAutosavedImageBackendDefaults({
  backend,
  settingsLoaded,
  saved,
  currentModel,
  currentParams,
  applySaved,
  saveDefaults,
}: UseAutosavedImageBackendDefaultsOptions): void {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistedSnapshotRef = useRef('')
  const loadedRef = useRef(false)
  const currentSnapshot = currentModel
    ? serializeImageBackendDefaults(currentModel, currentParams)
    : ''

  useEffect(() => {
    if (!backend || !saved) return
    if (loadedRef.current && currentSnapshot !== persistedSnapshotRef.current) return

    applySaved(saved)
    persistedSnapshotRef.current = serializeImageBackendDefaults(saved.model, saved.params)
    loadedRef.current = true
  }, [backend, saved, currentSnapshot, applySaved])

  useEffect(() => {
    if (!backend || !settingsLoaded || !currentModel) return
    if (!loadedRef.current) return
    if (currentSnapshot === persistedSnapshotRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void saveDefaults(backend, currentModel, currentParams).then(() => {
        persistedSnapshotRef.current = currentSnapshot
      }).catch((error) => {
        void window.electronAPI.appLog('error', 'Failed to persist image backend defaults', {
          backend,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, 800)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [backend, settingsLoaded, currentModel, currentParams, currentSnapshot, saveDefaults])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])
}
