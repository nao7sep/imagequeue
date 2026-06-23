import { BrowserWindow, IpcMainInvokeEvent, screen } from 'electron'
import path from 'path'
import { handle } from './ipc-boundary'
import { hardenWindow } from './utils/harden-window'

let viewerWin: BrowserWindow | null = null
let hidePromise: Promise<void> | null = null
let viewerClosing = false
let getMainWin: (() => BrowserWindow | null) | null = null
// Each open/update increments this. Stale async work (image decoding for an
// older navigation) checks the counter before showing the window so rapid
// arrow-key navigation never paints an intermediate frame.
let openGeneration = 0

const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100vw; height: 100vh; overflow: hidden; background: #000; }
body { display: flex; align-items: center; justify-content: center; }
img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
</head>
<body>
<img id="img" alt="">
<script>
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Backspace') {
    e.preventDefault();
    window.electronAPI.viewerAction('delete');
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape' || e.key === ' ') {
    e.preventDefault();
    window.electronAPI.closeViewer();
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    window.electronAPI.viewerAction('remove');
    return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    window.electronAPI.viewerAction('delete');
    return;
  }
  var navMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  var dir = navMap[e.key];
  if (dir) {
    e.preventDefault();
    window.electronAPI.viewerNavigate(dir);
  }
});
</script>
</body>
</html>`

function getViewerDisplay(event: IpcMainInvokeEvent): Electron.Display {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (owner && !owner.isDestroyed()) {
    return screen.getDisplayMatching(owner.getBounds())
  }
  return screen.getPrimaryDisplay()
}

function applyPresentationMode(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setKiosk(true)
}

function leavePresentationMode(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setKiosk(false)
  win.setVisibleOnAllWorkspaces(false)
  win.setAlwaysOnTop(false)
}

function notifyMainWin(channel: 'viewer:opened' | 'viewer:closed' | 'viewer:navigate' | 'viewer:action', payload?: unknown): void {
  const main = getMainWin?.()
  if (!main || main.isDestroyed()) return
  main.webContents.send(channel, payload)
}

function focusMainWin(): void {
  const main = getMainWin?.()
  if (!main || main.isDestroyed()) return
  if (main.isMinimized()) main.restore()
  main.focus()
}

function createViewerWindow(display: Electron.Display): BrowserWindow {
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  hardenWindow(win)

  win.on('close', (event) => {
    if (viewerClosing) return
    event.preventDefault()
    void hideViewer()
  })

  win.on('closed', () => {
    if (viewerWin === win) viewerWin = null
  })

  return win
}

async function openViewer(event: IpcMainInvokeEvent, dataUrl: string): Promise<void> {
  if (hidePromise) await hidePromise

  const display = getViewerDisplay(event)
  const generation = ++openGeneration

  if (!viewerWin || viewerWin.isDestroyed()) {
    viewerWin = createViewerWindow(display)
    await viewerWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(VIEWER_HTML))
  } else {
    viewerWin.setBounds(display.bounds, false)
  }

  // If a newer open superseded us while loading, bail.
  if (generation !== openGeneration) return

  const win = viewerWin
  if (!win || win.isDestroyed()) return
  await win.webContents.executeJavaScript(
    '(() => { const img = document.getElementById("img"); img.src = ' +
      JSON.stringify(dataUrl) +
      '; return img.decode().catch(() => {}); })()'
  )
  // Another navigation arrived while we were decoding — let it paint instead.
  if (generation !== openGeneration) return
  if (win.isDestroyed()) return
  const wasVisible = win.isVisible()
  // Apply kiosk / always-on-top only when the window is about to appear for
  // the first time (or after being hidden). On subsequent arrow-key swaps it
  // is already in presentation mode, so re-applying is unnecessary and would
  // briefly hide the menu/dock earlier than needed.
  if (!wasVisible) applyPresentationMode(win)
  win.show()
  win.focus()
  if (!wasVisible) notifyMainWin('viewer:opened')
}

async function hideViewer(): Promise<void> {
  const win = viewerWin
  if (!win || win.isDestroyed()) {
    viewerWin = null
    return
  }

  if (hidePromise) return hidePromise

  // Bump generation so any in-flight openViewer call discards its result.
  openGeneration++
  const wasVisible = win.isVisible()

  hidePromise = new Promise<void>((resolve) => {
    leavePresentationMode(win)
    win.hide()
    setImmediate(resolve)
  }).finally(() => {
    hidePromise = null
  })

  await hidePromise
  if (wasVisible) {
    notifyMainWin('viewer:closed')
    focusMainWin()
  }
}

export function closeViewerWindow(): void {
  const win = viewerWin
  if (!win || win.isDestroyed()) return
  viewerClosing = true
  const wasVisible = win.isVisible()
  openGeneration++
  leavePresentationMode(win)
  win.destroy()
  viewerClosing = false
  viewerWin = null
  if (wasVisible) notifyMainWin('viewer:closed')
}

export function registerViewerIpc(getMain: () => BrowserWindow | null): void {
  getMainWin = getMain
  handle('viewer:open', openViewer)
  handle('viewer:close', hideViewer)
  handle('viewer:navigate', (_event, dir: 'up' | 'down' | 'left' | 'right') => {
    notifyMainWin('viewer:navigate', dir)
  })
  handle('viewer:action', (_event, action: 'remove' | 'delete') => {
    notifyMainWin('viewer:action', action)
  })
}
