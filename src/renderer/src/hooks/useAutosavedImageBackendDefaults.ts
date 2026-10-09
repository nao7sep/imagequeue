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
  const persistedSnapshotRef = useRef('')
  const submittedSnapshotRef = useRef('')
  const loadedRef = useRef(false)
  const applyingSavedRef = useRef(false)
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

    applyingSavedRef.current = true
    applySaved(saved)
    persistedSnapshotRef.current = savedSnapshot
    submittedSnapshotRef.current = savedSnapshot
    loadedRef.current = true
  }, [backend, saved, currentSnapshot, applySaved])

  useEffect(() => {
    // applySaved schedules React state for the next render. Do not submit this
    // render's pre-hydration defaults while that update is still being applied.
    if (applyingSavedRef.current) { applyingSavedRef.current = false; return }
    if (!backend || !settingsLoaded || !currentModel) return
    if (!loadedRef.current) return
    if (currentSnapshot === submittedSnapshotRef.current) return
    submittedSnapshotRef.current = currentSnapshot

    // Hand the edit to main immediately; its owner coalesces and survives window loss.
    const attempt = ++saveAttemptRef.current
    void saveDefaults(backend, currentModel, currentParams).then(() => {
      if (saveAttemptRef.current !== attempt) return
      persistedSnapshotRef.current = currentSnapshot
      setSaveFailure(null)
    }).catch((error) => {
      recordOperationalDiagnostic('Failed to persist image backend defaults', error, { backend })
      if (saveAttemptRef.current === attempt) setSaveFailure(SAVE_FAILURE)
    })

  }, [backend, settingsLoaded, currentModel, currentParams, currentSnapshot, saveDefaults])

  useEffect(() => {
    return () => {
      saveAttemptRef.current += 1
    }
  }, [])

  return {
    saveFailure,
    dismissSaveFailure: () => setSaveFailure(null),
  }
}
