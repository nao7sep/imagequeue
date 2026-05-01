import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import fs from 'fs'

let notificationWin: BrowserWindow | null = null
let dismissTimeout: ReturnType<typeof setTimeout> | null = null
let isShowing = false

const WIN_W = 240
const WIN_H = 36

const NOTIFICATION_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100vw; height: 100vh; overflow: hidden; background: transparent; }
.toast {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding: 0 10px;
  color: #e8e8e8;
  user-select: none;
  cursor: default;
  white-space: nowrap;
  overflow: hidden;
  background: #1c1c1e;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 4px 16px rgba(0,0,0,0.55);
}
.toast.success { background: #0f2d1e; border-color: rgba(74,222,128,0.18); }
.toast.failure { background: #2d0f0f; border-color: rgba(248,113,113,0.22); }
</style>
</head>
<body>
<div class="toast" id="toast"></div>
</body>
</html>`

function clearDismissTimeout(): void {
  if (dismissTimeout !== null) {
    clearTimeout(dismissTimeout)
    dismissTimeout = null
  }
}

// Pre-create the window at startup so no new window is ever created while the
// app is in the background (which would activate the app on macOS).
export function initNotificationWindow(): void {
  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    frame: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    transparent: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  win.on('closed', () => {
    clearDismissTimeout()
    notificationWin = null
    isShowing = false
  })

  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(NOTIFICATION_HTML))
  notificationWin = win
}

function showNotification(type: 'success' | 'failure', mainWin: BrowserWindow | null): void {
  if (isShowing) return
  const win = notificationWin
  if (!win || win.isDestroyed()) return

  const display = mainWin && !mainWin.isDestroyed()
    ? screen.getDisplayMatching(mainWin.getBounds())
    : screen.getPrimaryDisplay()

  const { x: dx, y: dy, width: dw } = display.workArea
  win.setBounds({ x: Math.round(dx + (dw - WIN_W) / 2), y: dy + 20, width: WIN_W, height: WIN_H })

  const label = type === 'success' ? '\u2713 Generation complete' : '\u2717 Generation failed'
  const cssClass = type === 'success' ? 'toast success' : 'toast failure'

  // Lock immediately so a second rapid call is rejected while executeJavaScript is in-flight.
  isShowing = true

  void win.webContents.executeJavaScript(
    `(function(){var t=document.getElementById('toast');t.className=${JSON.stringify(cssClass)};t.textContent=${JSON.stringify(label)};})()`
  ).then(() => {
    if (win.isDestroyed()) { isShowing = false; return }
    win.showInactive()
    dismissTimeout = setTimeout(() => {
      if (!win.isDestroyed()) win.hide()
      isShowing = false
    }, 3000)
  }).catch(() => {
    isShowing = false
  })
}

export function closeNotificationWindow(): void {
  clearDismissTimeout()
  isShowing = false
  const win = notificationWin
  notificationWin = null
  if (win && !win.isDestroyed()) win.destroy()
}

export function registerNotificationIpc(getMainWin: () => BrowserWindow | null): void {
  ipcMain.handle('notification:show', (_event, type: 'success' | 'failure') => {
    showNotification(type, getMainWin())
  })

  ipcMain.handle('notification:loadAudioFile', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return null
    const data = await fs.promises.readFile(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4'
    }
    const mime = mimeMap[ext] ?? 'audio/mpeg'
    return `data:${mime};base64,${data.toString('base64')}`
  })
}
