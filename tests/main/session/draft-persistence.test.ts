import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
}))

const {
  getDraftPersistenceState,
  markDraftPersistenceFailed,
  markDraftPersistenceSaved,
} = await import('../../../src/main/session/draft-persistence')

describe('session draft persistence publication', () => {
  beforeEach(() => {
    markDraftPersistenceSaved()
    send.mockClear()
  })

  it('publishes one failure per unresolved episode', () => {
    markDraftPersistenceFailed()
    markDraftPersistenceFailed()

    expect(getDraftPersistenceState().status).toBe('failed')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      'session:draftPersistenceState',
      expect.objectContaining({ status: 'failed' }),
    )
  })

  it('publishes recovery only after a failure and allows a later failure', () => {
    markDraftPersistenceFailed()
    markDraftPersistenceSaved()
    markDraftPersistenceSaved()
    markDraftPersistenceFailed()

    expect(send.mock.calls.map((call) => call[1].status)).toEqual([
      'failed',
      'saved',
      'failed',
    ])
  })
})
