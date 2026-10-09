import { describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  openPath: vi.fn(async () => ''),
}))

vi.mock('electron', () => ({ shell: { openPath: mocks.openPath } }))
vi.mock('../../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../../src/main/session/state', () => ({
  resolveSessionDir: (sessionId: string) => `/imagequeue/sessions/${sessionId}`,
}))
vi.mock('../../../src/main/session/draft-persistence', () => ({ getDraftPersistenceState: vi.fn() }))

const { registerSessionIpc } = await import('../../../src/main/session/ipc')
registerSessionIpc()

function openFolder(sessionId: string): unknown {
  return mocks.handlers.get('session:openFolder')!({ sender: {} }, sessionId)
}

// Open Folder may be the only action an unopenable session offers, so the OS
// shell's refusal must reach the session modal rather than resolve as success.
describe('session:openFolder', () => {
  it("opens the session's own folder", async () => {
    await openFolder('20260101-000000-utc')
    expect(mocks.openPath).toHaveBeenCalledWith('/imagequeue/sessions/20260101-000000-utc')
  })

  it('rejects when the OS shell cannot open it', async () => {
    mocks.openPath.mockResolvedValueOnce('no associated application')
    await expect(openFolder('20260101-000000-utc')).rejects.toThrow(/no associated application/)
  })
})
