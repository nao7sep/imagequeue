import { BrowserWindow, IpcMainInvokeEvent, ipcMain, screen } from 'electron'
import path from 'path'

let viewerWin: BrowserWindow | null = null
let hidePromise: Promise<void> | null = null
let viewerClosing = false

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
  if (e.key === 'Escape' || e.key === ' ') {
    e.preventDefault();
    window.electronAPI.closeViewer();
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
      contextIsolation: true
    }
  })

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

  if (!viewerWin || viewerWin.isDestroyed()) {
    viewerWin = createViewerWindow(display)
    await viewerWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(VIEWER_HTML))
  } else {
    viewerWin.setBounds(display.bounds, false)
  }

  const win = viewerWin
  applyPresentationMode(win)
  await win.webContents.executeJavaScript(
    '(() => { const img = document.getElementById("img"); img.src = ' +
      JSON.stringify(dataUrl) +
      '; return img.decode().catch(() => {}); })()'
  )
  win.show()
  win.focus()
}

async function hideViewer(): Promise<void> {
  const win = viewerWin
  if (!win || win.isDestroyed()) {
    viewerWin = null
    return
  }

  if (hidePromise) return hidePromise

  hidePromise = new Promise<void>((resolve) => {
    leavePresentationMode(win)
    win.hide()
    setImmediate(resolve)
  }).finally(() => {
    hidePromise = null
  })

  return hidePromise
}

export function closeViewerWindow(): void {
  const win = viewerWin
  if (!win || win.isDestroyed()) return
  viewerClosing = true
  leavePresentationMode(win)
  win.destroy()
  viewerClosing = false
  viewerWin = null
}

export function registerViewerIpc(): void {
  ipcMain.handle('viewer:open', openViewer)
  ipcMain.handle('viewer:close', hideViewer)
}
