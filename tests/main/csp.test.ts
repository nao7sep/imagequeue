import { describe, expect, it, vi } from 'vitest'

// installContentSecurityPolicy never exposes the policy string; it registers an
// onHeadersReceived handler that stamps the Content-Security-Policy response
// header. To assert the *real* production policy without touching shipped code,
// stub electron's session down to that one registration, capture the handler,
// and invoke it the way Electron would for a production file:// document. The
// header it writes back is exactly the string the renderer runs under.
const hoisted = vi.hoisted(() => ({
  handler: undefined as
    | ((
        details: { url: string; responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders?: Record<string, string[] | string> }) => void,
      ) => void)
    | undefined,
}))

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived(handler: typeof hoisted.handler) {
          hoisted.handler = handler
        },
      },
    },
  },
}))

import { installContentSecurityPolicy } from '../../src/main/csp'

// Drives the registered handler for a production file:// document and returns the
// single Content-Security-Policy header value that was stamped onto it.
function installedProductionPolicy(): string {
  installContentSecurityPolicy(true)
  if (!hoisted.handler) throw new Error('onHeadersReceived handler was never registered')
  let policy: string | undefined
  hoisted.handler({ url: 'file:///index.html', responseHeaders: {} }, (response) => {
    const header = response.responseHeaders?.['Content-Security-Policy']
    policy = Array.isArray(header) ? header[0] : header
  })
  if (typeof policy !== 'string') throw new Error('no Content-Security-Policy header was set')
  return policy
}

// The exact production policy, snapshotted from src/main/csp.ts. Pinning the full
// string makes any future drop or weakening of a directive a failing test rather
// than a silent regression that ships an under-protected renderer.
const EXPECTED_PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join('; ')

describe('production Content-Security-Policy', () => {
  it('is present and non-empty', () => {
    const policy = installedProductionPolicy()
    expect(policy).toBeTruthy()
    expect(policy.trim().length).toBeGreaterThan(0)
  })

  it("is strict: no 'unsafe-inline' or 'unsafe-eval' in script-src or anywhere", () => {
    const policy = installedProductionPolicy()
    const scriptSrc = policy
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBe("script-src 'self'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain("'unsafe-inline' 'unsafe-eval'")
    // 'unsafe-inline' is permitted only on style-src (inline styles); it must
    // never appear in script-src.
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('keeps the full expected baseline of directives (exact string)', () => {
    expect(installedProductionPolicy()).toBe(EXPECTED_PRODUCTION_CSP)
  })
})
