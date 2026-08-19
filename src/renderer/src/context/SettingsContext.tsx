import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { ApiKeyPresence, CloudBackendId } from '../../../shared/types'

interface SettingsContextValue {
  settings: Record<string, unknown> | null
  // Which keys actually resolve, environment values included. It rides beside
  // `settings` rather than inside it because the two answer different questions:
  // `settings.image_backends[b].api_key` is the STORED value the settings form
  // edits, deliberately blind to the environment, while this is whether the
  // backend can be called at all. Every readiness check must use this one —
  // reading the stored string instead is what made an env-only backend look
  // unconfigured. Null until loaded; treat null as "not yet known", never as
  // absent (see hasApiKeyFor).
  apiKeyPresence: ApiKeyPresence | null
  saveChangedSettings: (base: Record<string, unknown>, next: Record<string, unknown>) => Promise<Record<string, unknown>>
  saveBrainstormSettings: (brainstorm: Record<string, unknown>) => Promise<Record<string, unknown>>
  saveImageBackendDefaults: (backend: CloudBackendId, model: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>
  saveNotificationField: (field: string, value: unknown) => Promise<Record<string, unknown>>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)
  const [apiKeyPresence, setApiKeyPresence] = useState<ApiKeyPresence | null>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then((cfg) => setSettings(cfg as Record<string, unknown>))
    void window.electronAPI.getApiKeyPresence().then(setApiKeyPresence)
  }, [])

  // Apply the configured UI font by overriding the `--font-ui` CSS variable on :root; blank reverts
  // to the styles.css default. The string is handed to CSS verbatim (engine-resolved, graceful
  // fallback) per the app-chrome-conventions; the mono surfaces (--font-mono) are unaffected.
  const uiFontFamily = (((settings?.general as Record<string, unknown> | undefined)?.ui_font_family) as string | undefined) ?? ''
  useEffect(() => {
    const family = uiFontFamily.trim()
    const root = document.documentElement
    if (family) root.style.setProperty('--font-ui', family)
    else root.style.removeProperty('--font-ui')
  }, [uiFontFamily])

  // Every save refreshes presence alongside the settings: storing or clearing a
  // key changes what resolves, and an env-supplied key means the stored value
  // and the presence flag can disagree in either direction.
  const refreshSettings = useCallback(async (): Promise<Record<string, unknown>> => {
    const [fresh, presence] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getApiKeyPresence(),
    ])
    const next = fresh as Record<string, unknown>
    setSettings(next)
    setApiKeyPresence(presence)
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
        apiKeyPresence,
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
