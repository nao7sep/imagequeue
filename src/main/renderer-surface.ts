import type { BrowserWindow } from 'electron'
import path from 'path'

import type { RendererSurface } from '../shared/renderer-surface'

/** The preload script every app window runs. */
export const PRELOAD_PATH = path.join(__dirname, '../preload/index.js')

/** Loads the app's renderer into a secondary window as the given surface, from
 *  the dev server in development and from the bundle otherwise. */
export async function loadRendererSurface(win: BrowserWindow, surface: RendererSurface): Promise<void> {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    const url = new URL(rendererUrl)
    url.searchParams.set('surface', surface)
    await win.loadURL(url.toString())
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { surface } })
  }
}
