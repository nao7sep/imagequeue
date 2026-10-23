import type { BrowserWindow } from 'electron'
import { onLanguageChanged } from './i18n'

/** Keep an authored native title instead of the shared renderer document title. */
export function retainWindowTitle(win: BrowserWindow, title: () => string): void {
  win.on('page-title-updated', (event) => event.preventDefault())
  const unsubscribe = onLanguageChanged(() => {
    if (!win.isDestroyed()) win.setTitle(title())
  })
  win.once('closed', unsubscribe)
}
