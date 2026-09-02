import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
}))

const {
  getModelParamsPersistenceState,
  markModelParamsPersistenceFailed,
  markModelParamsPersistenceSaved,
} = await import('../../src/main/model-params-persistence')

describe('Draw Things parameter persistence publication', () => {
  beforeEach(() => {
    markModelParamsPersistenceSaved()
    send.mockClear()
  })

  it('publishes one failure per unresolved save episode', () => {
    markModelParamsPersistenceFailed()
    markModelParamsPersistenceFailed()

    expect(getModelParamsPersistenceState()).toEqual(expect.objectContaining({
      status: 'failed',
      message: expect.stringContaining('change a parameter to retry'),
    }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      'drawthings:paramsPersistenceState',
      expect.objectContaining({ status: 'failed' }),
    )
  })

  it('publishes recovery only after a successful write and allows a later failure', () => {
    markModelParamsPersistenceFailed()
    markModelParamsPersistenceSaved()
    markModelParamsPersistenceSaved()
    markModelParamsPersistenceFailed()

    expect(send.mock.calls.map((call) => call[1].status)).toEqual([
      'failed',
      'saved',
      'failed',
    ])
  })
})
