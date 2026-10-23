import { describe, expect, it, vi } from 'vitest'
import { PrimaryRendererRecovery } from '../../src/main/primary-renderer-recovery'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const options = { load: vi.fn(async () => {}), isDestroyed: vi.fn(() => false), onStartupFailure: vi.fn(), onRuntimeFailure: vi.fn() }
  const owner = new PrimaryRendererRecovery(options)
  return { owner, ...options }
}
const gone = { reason: 'crashed', exitCode: 7 }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('primary renderer recovery', () => {
  it('routes initial rejection to startup with its original cause', async () => {
    const f = fixture()
    const error = new Error('EACCES /private/renderer SENTINEL')
    f.load.mockRejectedValue(error)
    f.owner.start()
    await settle()
    expect(f.onStartupFailure).toHaveBeenCalledExactlyOnceWith(error)
    expect(f.onRuntimeFailure).not.toHaveBeenCalled()
  })

  it('waits for explicit restore after loss and coalesces overlapping reloads', async () => {
    const f = fixture()
    f.owner.start()
    await settle()
    expect(f.owner.isReady()).toBe(true)
    f.owner.rendererGone(gone)
    expect(f.owner.isReady()).toBe(false)
    expect(f.load).toHaveBeenCalledOnce()
    expect(f.onRuntimeFailure.mock.calls[0]![0].cause).toEqual(gone)
    const held = deferred()
    f.load.mockReturnValueOnce(held.promise)
    const first = f.owner.restore()
    const second = f.owner.restore()
    expect(first).toBe(second)
    expect(f.load).toHaveBeenCalledTimes(2)
    held.resolve()
    await expect(first).resolves.toBe(true)
    expect(f.owner.isReady()).toBe(true)
    await expect(f.owner.restore()).resolves.toBe(true)
    expect(f.load).toHaveBeenCalledTimes(2)
    expect(f.onStartupFailure).not.toHaveBeenCalled()
  })

  it('keeps failed runtime recovery retryable without restarting application work', async () => {
    const f = fixture()
    f.owner.start()
    await settle()
    f.owner.rendererGone(gone)
    const error = new Error('ERR_CONNECTION_REFUSED /private/renderer SENTINEL')
    f.load.mockRejectedValueOnce(error)
    await expect(f.owner.restore()).resolves.toBe(false)
    expect(f.onRuntimeFailure).toHaveBeenLastCalledWith(error)
    expect(f.onStartupFailure).not.toHaveBeenCalled()
    await expect(f.owner.restore()).resolves.toBe(true)
    expect(f.load).toHaveBeenCalledTimes(3)
  })

  it('does not treat late navigation success after another crash as recovery', async () => {
    const f = fixture()
    f.owner.start()
    await settle()
    f.owner.rendererGone(gone)
    const held = deferred()
    f.load.mockReturnValueOnce(held.promise)
    const recovery = f.owner.restore()
    f.owner.rendererGone(gone)
    held.resolve()
    await expect(recovery).resolves.toBe(false)
    await expect(f.owner.restore()).resolves.toBe(true)
    expect(f.load).toHaveBeenCalledTimes(3)
  })

  it('ignores navigation settlement after the native window closes', async () => {
    const f = fixture()
    const held = deferred()
    f.load.mockReturnValueOnce(held.promise)
    f.owner.start()
    f.isDestroyed.mockReturnValue(true)
    held.reject(new Error('window closed'))
    await settle()
    expect(f.onStartupFailure).not.toHaveBeenCalled()
    expect(f.onRuntimeFailure).not.toHaveBeenCalled()
    await expect(f.owner.restore()).resolves.toBe(false)
  })

  it('reports a crash during initial loading once and ignores its trailing rejection', async () => {
    const f = fixture()
    const held = deferred()
    f.load.mockReturnValueOnce(held.promise)
    f.owner.start()
    f.owner.rendererGone(gone)
    held.reject(new Error('trailing navigation failure'))
    await settle()
    expect(f.onStartupFailure).toHaveBeenCalledOnce()
    expect(f.onRuntimeFailure).not.toHaveBeenCalled()
  })
})
