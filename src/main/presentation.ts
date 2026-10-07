import { BrowserWindow } from 'electron'
import { log, serializeError } from './logger'

/** Presentation is secondary to the operation that already committed. */
export function broadcastPresentation(channel: string, value: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, value)
    } catch (error) {
      log('warn', 'Window presentation failed', { channel, error: serializeError(error) })
    }
  }
}
