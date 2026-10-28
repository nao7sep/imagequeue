import { useCallback } from 'react'
import { useSettings } from '../context/SettingsContext'
import { clearOperationalFailure, reportOperationalFailure } from '../utils/operationalFailure'

// The completion-sound volume is a notification setting (config.json), 0–1,
// where zero mutes. Both volume sliders read it from the one settings snapshot
// and save it through main, so they cannot drift apart.
export function useNotificationVolume(): { volume: number; commitVolume: (volume: number) => Promise<boolean> } {
  const { settings, saveNotificationField } = useSettings()
  const notifications = (settings?.notifications ?? {}) as Record<string, unknown>
  const volume = typeof notifications.volume === 'number' ? notifications.volume : 0
  const commitVolume = useCallback((next: number): Promise<boolean> => {
    return saveNotificationField('volume', next)
      .then(() => { clearOperationalFailure('notification-volume-save'); return true })
      .catch((error) => {
        reportOperationalFailure('notification-volume-save', 'failure.settingsSave', 'Failed to save notification volume', error)
        return false
      })
  }, [saveNotificationField])
  return { volume, commitVolume }
}
