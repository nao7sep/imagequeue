import { useEffect } from 'react'

/** Appearance is shared by every surface without loading credential settings. */
export function UiFont(): null {
  useEffect(() => {
    let active = true
    let changed = false
    const apply = (value: string): void => {
      const family = value.trim()
      if (family) document.documentElement.style.setProperty('--font-ui', family)
      else document.documentElement.style.removeProperty('--font-ui')
    }
    const unsubscribe = window.electronAPI.onUiFontChanged((family) => {
      changed = true
      if (active) apply(family)
    })
    void window.electronAPI.getSettings().then((settings) => {
      if (!active || changed) return
      apply((settings.general as { ui_font_family: string }).ui_font_family)
    }).catch(() => {
      // Startup recovery can run without a readable config or settings IPC.
      // Its built-in CSS font keeps that failure surface usable.
    })
    return () => { active = false; unsubscribe() }
  }, [])
  return null
}
