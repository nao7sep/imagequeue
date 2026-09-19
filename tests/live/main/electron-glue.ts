// Electron as the live lane substitutes it: only the window, dialog, shell, and
// OS glue the main process touches. The IPC handlers the main process registers
// are kept so a test can invoke them as the renderer would. Each live test file
// installs it with vi.mock('electron', () => import('<path>/electron-glue')).

import { rm } from 'node:fs/promises'

type Handler = (event: unknown, ...args: unknown[]) => unknown

export const handlers = new Map<string, Handler>()

export const ipcMain = {
  handle: (channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  },
  on: () => {},
  removeHandler: (channel: string) => {
    handlers.delete(channel)
  },
}

export const app = {
  getVersion: () => '0.0.0-live',
  getPath: () => '/tmp',
  getAppPath: () => process.cwd(),
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  on: () => {},
}

export const BrowserWindow = {
  getAllWindows: () => [],
  getFocusedWindow: () => null,
  fromWebContents: () => null,
}

export const nativeTheme = { on: () => {}, themeSource: 'system', shouldUseDarkColors: false }
export const powerSaveBlocker = { start: () => 0, stop: () => {}, isStarted: () => false }
export const nativeImage = { createFromPath: () => ({}), createFromBuffer: () => ({}), createEmpty: () => ({}) }
export const clipboard = {}
export const dialog = {}
// Every home is throwaway, so removing an item stands in for the OS trash.
export const shell = {
  trashItem: (path: string) => rm(path, { recursive: true, force: true }),
}
export const screen = {}
export const session = {}
export const Menu = {}
export class Tray {}
export class ClipboardItem {}
