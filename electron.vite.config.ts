import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Single source of truth for the app version: package.json. Injected into the
// renderer as __APP_VERSION__ so the About dialog never drifts from the release.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  main: {
    define: {
      __APP_VERSION__: JSON.stringify(version)
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      // Loaded from disk, not over a network: the default 500 kB warning measures
      // transfer cost. 2000 keeps a runaway bundle loud without flagging the
      // ten-language catalogues on every build.
      chunkSizeWarningLimit: 2000
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    build: {
      minify: true,
      chunkSizeWarningLimit: 2000 // see the main build block
    },
    server: {
      host: '127.0.0.1',
      port: 20641,
      strictPort: true
    },
    define: {
      __APP_VERSION__: JSON.stringify(version)
    }
  }
})
