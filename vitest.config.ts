import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// __APP_VERSION__ is injected from package.json in electron.vite.config.ts for the build; mirror it here
// so any test touching version-displaying code (e.g. AboutModal) resolves it too.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Most tests cover pure main/shared logic in a plain Node environment. A few
// renderer tests (*.test.tsx) opt into jsdom per-file with a
// `// @vitest-environment jsdom` header to exercise real-DOM focus/keyboard
// behavior in the listbox layer. The React plugin compiles the JSX/TSX; it is a
// no-op for the JSX-free .ts tests. Tests live under tests/, mirroring src/, so
// src/ stays pure shipped code and the production typecheck never sees them.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      // V8's native coverage; `include` spans all source so the report flags
      // logic no test reaches, not just a score for what is reached.
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Excluded as framework wiring with no decision to cover:
      exclude: [
        'src/main/index.ts', // Electron main entry / bootstrap
        'src/preload/**', // contextBridge wiring
        'src/renderer/src/main.tsx', // React DOM mount
        '**/*.d.ts'
      ]
    }
  }
})
