import { loadAudioFile } from './audio-protocol'
import { BrowserWindow, screen } from 'electron'
import { handle } from './ipc-boundary'
import { loadConfig } from './config'
import { log, serializeError } from './logger'
import { hardenWindow } from './utils/harden-window'
import { mainTranslator } from './i18n'
import { TOAST_MARKS } from '../shared/toast-marks'
import { APP_NAME } from '../shared/app-identity'

let notificationWin: BrowserWindow | null = null
let dismissTimeout: ReturnType<typeof setTimeout> | null = null
let isShowing = false

const WIN_MIN_W = 180
const WIN_MAX_W = 360
const WIN_H = 36
const MARGIN_Y = 100

const NOTIFICATION_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100vw; height: 100vh; overflow: hidden; background: transparent; }
.toast {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 4px;
  font-family: system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding: 0 10px;
  color: #1c1c1e;
  user-select: none;
  cursor: default;
  overflow: hidden;
  background: #f6f6f8;
  border: 1px solid rgba(0,0,0,0.1);
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
}
.toast-app {
  flex-shrink: 0;
  opacity: 0.72;
  font-size: 11px;
  font-weight: 600;
}
.toast-message {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toast.success { background: #e3f5e9; border-color: rgba(22,163,74,0.3); }
.toast.failure { background: #fbe6e6; border-color: rgba(220,38,38,0.3); }
/* The toast window follows prefers-color-scheme, which follows
   nativeTheme.themeSource like every other window. */
@media (prefers-color-scheme: dark) {
  .toast { color: #e8e8e8; background: #1c1c1e; border-color: rgba(255,255,255,0.08); box-shadow: 0 4px 16px rgba(0,0,0,0.55); }
  .toast.success { background: #0f2d1e; border-color: rgba(74,222,128,0.18); }
  .toast.failure { background: #2d0f0f; border-color: rgba(248,113,113,0.22); }
}
</style>
</head>
<body>
<div class="toast" id="toast">
  <span class="toast-app">ImageQueue</span>
  <span class="toast-message" id="toast-message"></span>
</div>
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
    width: WIN_MAX_W,
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
      contextIsolation: true,
      sandbox: true
    }
  })

  hardenWindow(win)

  win.on('closed', () => {
    clearDismissTimeout()
    notificationWin = null
    isShowing = false
  })

  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(NOTIFICATION_HTML))
  notificationWin = win
}

function showNotification(type: 'success' | 'failure'): void {
  if (isShowing) return
  const win = notificationWin
  if (!win || win.isDestroyed()) return

  const display = screen.getPrimaryDisplay()

  // Drawn, not typed: the toast renders in a user-configurable font, which is
  // exactly the weight-drift the app's drawn-icon rule exists to prevent.
  const MARK_SVG = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em">${TOAST_MARKS[type === 'success' ? 'check' : 'close']}</svg>`
  const translator = mainTranslator()
  const label = translator.t(type === 'success' ? 'toast.complete' : 'toast.failed')
  const cssClass = type === 'success' ? 'toast success' : 'toast failure'

  // Lock immediately so a second rapid call is rejected while executeJavaScript is in-flight.
  isShowing = true

  // The toast lives in its own window, so it can't read the renderer's --font-ui variable; apply the
  // configured UI font here (read fresh each show, so it tracks settings changes). Blank keeps the
  // window's baked-in default stack. The measure clone takes the same font so width stays accurate.
  const uiFont = loadConfig().general.ui_font_family?.trim() ?? ''

  void win.webContents.executeJavaScript(
    `(function(){
      // lang picks the right Chinese, Japanese or Korean glyphs for the label.
      document.documentElement.lang = ${JSON.stringify(translator.language)};
      var t = document.getElementById('toast');
      var m = document.getElementById('toast-message');
      t.className = ${JSON.stringify(cssClass)};
      // Fixed app-authored markup + a text node for the label — no user data.
      m.innerHTML = ${JSON.stringify(MARK_SVG)};
      m.appendChild(document.createTextNode(' ' + ${JSON.stringify(label)}));
      var font = ${JSON.stringify(uiFont)};
      t.style.fontFamily = font;

      var measure = document.createElement('div');
      measure.className = ${JSON.stringify(cssClass)};
      measure.style.fontFamily = font;
      measure.style.position = 'absolute';
      measure.style.left = '-10000px';
      measure.style.top = '-10000px';
      measure.style.inset = 'auto';
      measure.style.width = 'max-content';

      var app = document.createElement('span');
      app.className = 'toast-app';
      app.textContent = ${JSON.stringify(APP_NAME)};

      var msg = document.createElement('span');
      msg.className = 'toast-message';
      // Mirror the live span exactly (mark + label) so the measured width
      // matches what renders.
      msg.innerHTML = ${JSON.stringify(MARK_SVG)};
      msg.appendChild(document.createTextNode(' ' + ${JSON.stringify(label)}));

      measure.appendChild(app);
      measure.appendChild(msg);
      document.body.appendChild(measure);
      var width = Math.ceil(measure.getBoundingClientRect().width);
      measure.remove();
      return width;
    })()`
  ).then((measuredWidth) => {
    if (win.isDestroyed()) { isShowing = false; return }
    const width = Math.max(WIN_MIN_W, Math.min(WIN_MAX_W, Number(measuredWidth) || WIN_MAX_W))
    const { x: dx, y: dy, width: dw } = display.workArea
    win.setBounds({ x: Math.round(dx + (dw - width) / 2), y: dy + MARGIN_Y, width, height: WIN_H })
    win.showInactive()
    dismissTimeout = setTimeout(() => {
      if (!win.isDestroyed()) win.hide()
      isShowing = false
    }, 3000)
  }).catch((err) => {
    isShowing = false
    // A destroyed window mid-measurement is an expected race (the toast window
    // was closed while executeJavaScript was in flight), not an incident — keep
    // it quiet. Anything else is an unexpected render failure worth a warning.
    if (win.isDestroyed()) {
      log('debug', 'Notification render aborted: window closed', { type })
      return
    }
    log('warn', 'Notification render failed', { type, error: serializeError(err) })
  })
}

export function closeNotificationWindow(): void {
  clearDismissTimeout()
  isShowing = false
  const win = notificationWin
  notificationWin = null
  if (win && !win.isDestroyed()) win.destroy()
}

export function registerNotificationIpc(): void {
  handle('notification:show', (_event, type: 'success' | 'failure') => {
    showNotification(type)
  })

  handle('notification:loadAudioFile', (_event, filePath: string) => loadAudioFile(filePath))
}
