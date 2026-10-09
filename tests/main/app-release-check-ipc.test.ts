import { beforeEach, expect, it, vi } from 'vitest'
const stubs = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fetch: vi.fn(), save: vi.fn(async () => undefined), open: vi.fn(async () => undefined), present: vi.fn(),
}))
vi.mock('../../src/main/ipc-boundary', () => ({ handle: (name: string, fn: (...args: unknown[]) => unknown) => stubs.handlers.set(name, fn) }))
vi.mock('electron', () => ({ shell: { openExternal: stubs.open } }))
vi.mock('../../src/main/config', () => ({ loadConfig: () => ({ general: { check_github_releases_at_launch: true } }) }))
vi.mock('../../src/main/state-store', () => ({ readUiState: async () => ({}), recordReleaseCheckAttempt: stubs.save }))
vi.mock('../../src/main/dependencies/download', () => ({ fetchBytes: stubs.fetch }))
vi.mock('../../src/main/presentation', () => ({ broadcastPresentation: stubs.present }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
import { startAppReleaseCheck } from '../../src/main/app-release-check'

beforeEach(() => { vi.clearAllMocks(); stubs.handlers.clear(); vi.stubGlobal('__APP_VERSION__', '0.1.0') })
it('registers without network work; requests only tag metadata after readiness, with a short deadline and fixed identity', async () => {
  stubs.fetch.mockResolvedValue(Buffer.from('{"tag_name":"v1.0.0"}'))
  startAppReleaseCheck()
  expect(stubs.fetch).not.toHaveBeenCalled()
  stubs.handlers.get('appRelease:ready')!()
  await stubs.handlers.get('appRelease:check')!()
  expect(stubs.fetch).toHaveBeenCalledExactlyOnceWith(
    'https://api.github.com/repos/nao7sep/imagequeue/releases/latest',
    { maxBytes: 2097152, idleTimeoutMs: 10000, wholeTimeoutMs: 10000 }, undefined,
    { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'ImageQueue' },
  )
  expect(stubs.present).toHaveBeenCalledWith('appRelease:result', { kind: 'newer', version: 'v1.0.0' })
  expect(stubs.open).not.toHaveBeenCalled()
  await stubs.handlers.get('appRelease:view')!('https://untrusted.example')
  expect(stubs.open).toHaveBeenCalledExactlyOnceWith('https://github.com/nao7sep/imagequeue/releases/latest')
})
it('treats malformed JSON and non-success transport outcomes as failures', async () => {
  startAppReleaseCheck()
  stubs.fetch.mockResolvedValueOnce(Buffer.from('bad json'))
  expect(await stubs.handlers.get('appRelease:check')!()).toEqual({ kind: 'failed' })
  stubs.fetch.mockRejectedValueOnce(new Error('HTTP 403'))
  expect(await stubs.handlers.get('appRelease:check')!()).toEqual({ kind: 'failed' })
})
