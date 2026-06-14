import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Most tests cover pure main/shared logic in a plain Node environment. A few
// renderer tests (*.test.tsx) opt into jsdom per-file with a
// `// @vitest-environment jsdom` header to exercise real-DOM focus/keyboard
// behavior in the listbox layer. The React plugin compiles the JSX/TSX; it is a
// no-op for the JSX-free .ts tests. Tests live under tests/, mirroring src/, so
// src/ stays pure shipped code and the production typecheck never sees them.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}']
  }
})
