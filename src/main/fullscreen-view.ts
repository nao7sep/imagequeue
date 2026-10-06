import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { latestSelection, onSelectionPublished, SELECTION_SNAPSHOT_CHANNEL } from './selection-snapshot'
import { dismissSurfaceConfirms } from './surface-confirm'
import { loadRendererSurface } from './renderer-surface'
import { log, serializeError } from './logger'
import { hardenWindow } from './utils/harden-window'

// The fullscreen view: one image over the whole display, above the lists, which
// stay laid out beneath it. It is a page of the app (main.tsx, surface
// `fullscreen-view`) in one borderless window created on first open and reused,
// hidden on close. It follows the selection through the snapshot while open and
// is shown only once its page has decoded and painted the image, so opening and
// arrowing through images never shows an empty or intermediate frame.

export const FULLSCREEN_VIEW_OPENED_CHANNEL = 'fullscreenView:opened'
export const FULLSCREEN_VIEW_CLOSED_CHANNEL = 'fullscreenView:closed'

// The lowest level Electron documents as above both the Dock and menu bar on
// macOS and the taskbar on Windows; `status` and below sit beneath them.
export const FULLSCREEN_VIEW_LEVEL = 'pop-up-menu'

// How long an open waits for the page to paint before it is reported failed.
const PAINT_TIMEOUT_MS = 5_000

interface Opening {
  version: number
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let view: BrowserWindow | null = null
let shown = false
let opening: Opening | null = null
// The last snapshot the page painted, so reopening on an unchanged selection
// shows the window at once instead of waiting for a paint that will not come.
let paintedVersion = 0
let getMainWin: () => BrowserWindow | null = () => null

export function buildFullscreenViewOptions(bounds: Electron.Rectangle): Electron.BrowserWindowConstructorOptions {
  return {
    ...bounds,
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

/** The display the view covers: the one the main window is on. */
export function fullscreenViewDisplay(main: BrowserWindow | null): Electron.Display {
  if (main && !main.isDestroyed()) return screen.getDisplayMatching(main.getBounds())
  return screen.getPrimaryDisplay()
}

function notifyMain(channel: string): void {
  const main = getMainWin()
  if (main && !main.isDestroyed()) main.webContents.send(channel)
}

function focusMain(): void {
  const main = getMainWin()
  if (!main || main.isDestroyed()) return
  if (main.isMinimized()) main.restore()
  main.focus()
}

function settleOpening(error?: Error): void {
  const pending = opening
  if (!pending) return
  opening = null
  clearTimeout(pending.timer)
  if (error) pending.reject(error)
  else pending.resolve()
}

function forgetView(win: BrowserWindow): void {
  if (view !== win) return
  view = null
  paintedVersion = 0
  if (!win.isDestroyed()) win.destroy()
}

function createView(bounds: Electron.Rectangle): BrowserWindow {
  const win = new BrowserWindow(buildFullscreenViewOptions(bounds))
  win.setAlwaysOnTop(true, FULLSCREEN_VIEW_LEVEL)
  hardenWindow(win)

  // The window has no frame; a close from the system closes the view.
  win.on('close', (event) => {
    event.preventDefault()
    closeFullscreenView({ refocusMain: true })
  })
  // Switching to another app closes the view; the selection has followed its
  // navigation, so one Space reopens the same image.
  win.on('blur', () => {
    if (view === win && shown) closeFullscreenView({ refocusMain: false })
  })
  // A failed renderer never leaves a black window: the view closes and the next
  // open creates a fresh one.
  win.webContents.on('render-process-gone', (_event, details) => {
    if (view !== win) return
    log('warn', 'Fullscreen view renderer is gone', { reason: details.reason, exitCode: details.exitCode })
    const wasShown = shown
    shown = false
    settleOpening(new Error(`The fullscreen view's renderer is gone (${details.reason})`))
    dismissSurfaceConfirms('fullscreen-view')
    forgetView(win)
    if (wasShown) {
      notifyMain(FULLSCREEN_VIEW_CLOSED_CHANNEL)
      focusMain()
    }
  })
  win.on('closed', () => {
    if (view === win) view = null
  })

  void loadRendererSurface(win, 'fullscreen-view').catch((error) => {
    log('warn', 'Fullscreen view could not load', { error: serializeError(error) })
    settleOpening(error instanceof Error ? error : new Error(String(error)))
    forgetView(win)
  })
  return win
}

function showView(): void {
  const win = view
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
  shown = true
  settleOpening()
  notifyMain(FULLSCREEN_VIEW_OPENED_CHANNEL)
}

/** Opens the view on the selected image, settling once it is on screen. */
export function openFullscreenView(): Promise<void> {
  if (shown) return Promise.resolve()
  settleOpening()
  const { bounds } = fullscreenViewDisplay(getMainWin())
  const snapshot = latestSelection()
  if (!view || view.isDestroyed()) {
    // A fresh page asks for the latest snapshot itself once it has loaded.
    view = createView(bounds)
  } else {
    view.setBounds(bounds, false)
    if (paintedVersion === snapshot.version) {
      showView()
      return Promise.resolve()
    }
    view.webContents.send(SELECTION_SNAPSHOT_CHANNEL, snapshot)
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (opening?.timer !== timer) return
      settleOpening(new Error('The fullscreen view did not paint its image in time'))
    }, PAINT_TIMEOUT_MS)
    opening = { version: snapshot.version, resolve, reject, timer }
  })
}

/** The page reports each snapshot it has painted, or could not paint because
 *  the task has no image or the image did not load; a snapshot it cannot paint
 *  closes the view. Reports older than the latest selection are stale. */
export function fullscreenViewPainted(version: number, painted: boolean): void {
  if (painted) paintedVersion = Math.max(paintedVersion, version)
  if (version < latestSelection().version) return
  if (!painted) {
    closeFullscreenView({ refocusMain: true })
    return
  }
  if (opening && version >= opening.version) showView()
}

export function closeFullscreenView({ refocusMain }: { refocusMain: boolean }): void {
  settleOpening()
  if (!shown) return
  shown = false
  if (view && !view.isDestroyed()) view.hide()
  dismissSurfaceConfirms('fullscreen-view')
  notifyMain(FULLSCREEN_VIEW_CLOSED_CHANNEL)
  if (refocusMain) focusMain()
}

/** Destroys the view, on quit and when the main window is gone. */
export function destroyFullscreenView(): void {
  closeFullscreenView({ refocusMain: false })
  const win = view
  if (win) forgetView(win)
}

/** The view's page while it is open or opening, for routing keys and confirmations. */
export function fullscreenViewContents(): Electron.WebContents | null {
  if (!view || view.isDestroyed() || (!shown && !opening)) return null
  return view.webContents
}

export function initFullscreenView(getMain: () => BrowserWindow | null): void {
  getMainWin = getMain
  onSelectionPublished((snapshot) => {
    if (view && !view.isDestroyed() && (shown || opening)) view.webContents.send(SELECTION_SNAPSHOT_CHANNEL, snapshot)
  })
}
