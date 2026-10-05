import { useEffect, useRef, useState } from 'react'
import type { CloudBackendId } from '../../../shared/types'
import {
  serializeImageBackendDefaults,
  type SavedImageBackendDefaults,
} from '../utils/imageBackendDefaults'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'
import type { MessageKey } from '../../../shared/i18n/catalogues'

interface UseAutosavedImageBackendDefaultsOptions {
  backend: CloudBackendId | null
  settingsLoaded: boolean
  saved: SavedImageBackendDefaults | null
  currentModel: string
  currentParams: Record<string, unknown>
  applySaved: (saved: SavedImageBackendDefaults) => void
  saveDefaults: (backend: CloudBackendId, model: string, params: Record<string, unknown>) => Promise<unknown>
}

export interface ImageBackendDefaultsPersistence {
  saveFailure: MessageKey | null
  dismissSaveFailure: () => void
}

const SAVE_FAILURE = 'column.defaultsSaveFailed'

export function useAutosavedImageBackendDefaults({
  backend,
  settingsLoaded,
  saved,
  currentModel,
  currentParams,
  applySaved,
  saveDefaults,
}: UseAutosavedImageBackendDefaultsOptions): ImageBackendDefaultsPersistence {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistedSnapshotRef = useRef('')
  const loadedRef = useRef(false)
  const saveAttemptRef = useRef(0)
  const [saveFailure, setSaveFailure] = useState<MessageKey | null>(null)
  const currentSnapshot = currentModel
    ? serializeImageBackendDefaults(currentModel, currentParams)
    : ''

  useEffect(() => {
    if (!backend || !saved) return
    const savedSnapshot = serializeImageBackendDefaults(saved.model, saved.params)
    // After the first load, a saved record is applied only over a column with
    // nothing unsaved, and only when it says something new: one equal to the
    // column's own snapshot, such as its last save read back, would only reset
    // what the column holds beyond what is saved (another model's fields).
    if (loadedRef.current && (currentSnapshot !== persistedSnapshotRef.current || savedSnapshot === currentSnapshot)) return

    applySaved(saved)
    persistedSnapshotRef.current = savedSnapshot
    loadedRef.current = true
  }, [backend, saved, currentSnapshot, applySaved])

  useEffect(() => {
    if (!backend || !settingsLoaded || !currentModel) return
    if (!loadedRef.current) return
    if (currentSnapshot === persistedSnapshotRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const attempt = ++saveAttemptRef.current
      void saveDefaults(backend, currentModel, currentParams).then(() => {
        if (saveAttemptRef.current !== attempt) return
        persistedSnapshotRef.current = currentSnapshot
        setSaveFailure(null)
      }).catch((error) => {
        recordOperationalDiagnostic('Failed to persist image backend defaults', error, { backend })
        if (saveAttemptRef.current === attempt) setSaveFailure(SAVE_FAILURE)
      })
    }, 800)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [backend, settingsLoaded, currentModel, currentParams, currentSnapshot, saveDefaults])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveAttemptRef.current += 1
    }
  }, [])

  return {
    saveFailure,
    dismissSaveFailure: () => setSaveFailure(null),
  }
}
