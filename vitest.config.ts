import { defineConfig } from 'vitest/config'

// Unit tests cover pure main/shared-process logic only (no Electron, no jsdom).
// Tests live under tests/, mirroring the src/ layout, so src/ stays pure
// shipped code and the production typecheck never sees test files. The real
// logger no-ops until a session dir is set, so tests that don't assert on log
// output need no mock; the few that do mock the logger module locally.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
