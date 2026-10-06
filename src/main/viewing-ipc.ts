import type { BrowserWindow, WebContents } from 'electron'
import { handle } from './ipc-boundary'
import { latestSelection, publishSelection } from './selection-snapshot'
import { answerSurfaceConfirm, askSurface } from './surface-confirm'
import {
  closeFullscreenView,
  fullscreenViewContents,
  fullscreenViewPainted,
  initFullscreenView,
  openFullscreenView,
} from './fullscreen-view'
import type { ConfirmOptions } from '../shared/confirm'
import type { ListKey, SelectedImage, ViewingSurface } from '../shared/viewing'

export const LIST_KEY_CHANNEL = 'list:key'

const LIST_KEYS = new Set<string>(['up', 'down', 'left', 'right', 'space', 'remove', 'delete'] satisfies ListKey[])

// The page of each view outside the main window, while it can take a key or a
// confirmation.
const surfaces: Record<ViewingSurface, () => WebContents | null> = {
  'fullscreen-view': fullscreenViewContents,
  'preview-window': () => null,
}

function surfaceOf(sender: WebContents): ViewingSurface | null {
  for (const [surface, contents] of Object.entries(surfaces) as [ViewingSurface, () => WebContents | null][]) {
    if (contents() === sender) return surface
  }
  return null
}

/** The channels between the main window, which owns the selection, and the
 *  views that follow it. */
export function registerViewingIpc(getMain: () => BrowserWindow | null): void {
  initFullscreenView(getMain)
  const isMain = (sender: WebContents): boolean => getMain()?.webContents === sender

  handle('selection:publish', (event, task: SelectedImage | null) => {
    if (isMain(event.sender)) publishSelection(task)
  })
  handle('selection:latest', () => latestSelection())

  handle('fullscreenView:open', () => openFullscreenView())
  handle('fullscreenView:close', () => closeFullscreenView({ refocusMain: true }))
  handle('fullscreenView:painted', (_event, version: number, painted: boolean) => {
    fullscreenViewPainted(Number(version), painted === true)
  })

  // A view hands list keys to the main window, named with the view they came
  // from so a confirmation they lead to is shown there.
  handle('list:key', (event, key: string) => {
    const surface = surfaceOf(event.sender)
    const main = getMain()
    if (!surface || !LIST_KEYS.has(key) || !main || main.isDestroyed()) return
    main.webContents.send(LIST_KEY_CHANNEL, { key, surface })
  })

  // Null when the view is no longer there to ask; the main window then asks itself.
  handle('surface:confirm', (event, surface: ViewingSurface, options: ConfirmOptions): Promise<boolean> | null => {
    if (!isMain(event.sender) || !Object.hasOwn(surfaces, surface)) return null
    const contents = surfaces[surface]()
    return contents ? askSurface(surface, contents, options) : null
  })
  handle('surface:answerConfirm', (event, id: number, ok: boolean) => {
    answerSurfaceConfirm(Number(id), ok === true, event.sender)
  })
}
