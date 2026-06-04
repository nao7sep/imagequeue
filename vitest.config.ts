import { defineConfig } from 'vitest/config'

// Unit tests cover pure main/shared-process logic only (no Electron, no jsdom).
// See src/**/*.test.ts. The real logger no-ops until a session dir is set, so
// tests that don't assert on log output need no mock; the few that do mock the
// logger module locally.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
