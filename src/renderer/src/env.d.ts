/// <reference types="vite/client" />

interface ElectronAPI {
  platform: string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
