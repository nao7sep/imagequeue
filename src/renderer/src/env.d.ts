/// <reference types="vite/client" />

import type { ElectronAPI } from '../../preload/index'

declare global {
  // Injected at build time from package.json (see electron.vite.config.ts).
  const __APP_VERSION__: string
  interface Window {
    electronAPI: ElectronAPI
  }
}
