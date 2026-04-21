import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface SettingsContextValue {
  settings: Record<string, unknown> | null
  updateSettings: (next: Record<string, unknown>) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then((cfg) => setSettings(cfg as Record<string, unknown>))
  }, [])

  const updateSettings = useCallback(async (next: Record<string, unknown>): Promise<void> => {
    await window.electronAPI.saveSettings(next)
    // Re-fetch after save so the context always holds decoded values reflecting what's on disk.
    const fresh = await window.electronAPI.getSettings()
    setSettings(fresh as Record<string, unknown>)
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
