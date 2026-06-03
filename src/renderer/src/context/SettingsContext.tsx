import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { CloudBackendId } from '../../../shared/types'

interface SettingsContextValue {
  settings: Record<string, unknown> | null
  saveChangedSettings: (base: Record<string, unknown>, next: Record<string, unknown>) => Promise<Record<string, unknown>>
  saveBrainstormSettings: (brainstorm: Record<string, unknown>) => Promise<Record<string, unknown>>
  saveImageBackendDefaults: (backend: CloudBackendId, model: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>
  saveNotificationField: (field: string, value: unknown) => Promise<Record<string, unknown>>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then((cfg) => setSettings(cfg as Record<string, unknown>))
  }, [])

  const refreshSettings = useCallback(async (): Promise<Record<string, unknown>> => {
    const fresh = await window.electronAPI.getSettings()
    const next = fresh as Record<string, unknown>
    setSettings(next)
    return next
  }, [])

  const saveChangedSettings = useCallback(
    async (base: Record<string, unknown>, next: Record<string, unknown>): Promise<Record<string, unknown>> => {
      await window.electronAPI.saveChangedSettings(base, next)
      return refreshSettings()
    },
    [refreshSettings]
  )

  const saveBrainstormSettings = useCallback(
    async (brainstorm: Record<string, unknown>): Promise<Record<string, unknown>> => {
      await window.electronAPI.saveBrainstormSettings(brainstorm)
      return refreshSettings()
    },
    [refreshSettings]
  )

  const saveImageBackendDefaults = useCallback(
    async (backend: CloudBackendId, model: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      await window.electronAPI.saveImageBackendDefaults(backend, model, params)
      return refreshSettings()
    },
    [refreshSettings]
  )

  const saveNotificationField = useCallback(async (field: string, value: unknown): Promise<Record<string, unknown>> => {
    await window.electronAPI.saveNotificationField(field, value)
    return refreshSettings()
  }, [refreshSettings])

  return (
    <SettingsContext.Provider
      value={{
        settings,
        saveChangedSettings,
        saveBrainstormSettings,
        saveImageBackendDefaults,
        saveNotificationField,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
