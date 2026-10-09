import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openPath: vi.fn(async () => ''),
  sessionsDir: '/imagequeue/sessions',
}))

vi.mock('electron', () => ({ shell: { openPath: mocks.openPath } }))
vi.mock('../../../src/main/session/session', () => ({ getSessionsDir: () => mocks.sessionsDir }))

const { openSessionsFolder } = await import('../../../src/main/session/open-sessions-folder')

describe('openSessionsFolder', () => {
  it('opens the authoritative output root', async () => {
    await openSessionsFolder()
    expect(mocks.openPath).toHaveBeenCalledWith(mocks.sessionsDir)
  })

  it('surfaces an OS shell failure', async () => {
    mocks.openPath.mockResolvedValueOnce('no associated application')
    await expect(openSessionsFolder()).rejects.toThrow(/no associated application/)
  })
})
