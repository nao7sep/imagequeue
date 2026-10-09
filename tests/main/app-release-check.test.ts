import { describe, expect, it, vi } from 'vitest'
import { compareAppRelease, createAppReleaseCheckOwner, releaseCheckDue } from '../../src/main/app-release-check-owner'

const now = Date.parse('2026-10-09T00:00:00.000Z')
function setup(overrides = {}) {
  const io = {
    enabled: () => true,
    lastAttempt: async () => undefined,
    saveAttempt: vi.fn(async (_utc: string) => undefined),
    fetch: vi.fn(async () => ({ tag_name: 'v1.2.0' })),
    installed: '1.2.0', present: vi.fn(), log: vi.fn(), now: () => now,
    ...overrides,
  }
  return { io, owner: createAppReleaseCheckOwner(io) }
}

describe('GitHub app release check', () => {
  it('compares semantic precedence and refuses malformed responses', () => {
    expect(compareAppRelease({ tag_name: 'v1.10.0' }, '1.9.0')).toEqual({ kind: 'newer', version: 'v1.10.0' })
    expect(compareAppRelease({ tag_name: 'v1.2.0' }, '1.3.0-dev')).toEqual({ kind: 'current' })
    expect(compareAppRelease({ tag_name: 'v1.2.0' }, '1.2.0-beta')).toMatchObject({ kind: 'newer' })
    for (const payload of [null, {}, { tag_name: 1 }, { tag_name: 'v1.02.0' }, { tag_name: 'bad' }]) {
      expect(() => compareAppRelease(payload, '1.0.0')).toThrow()
    }
  })
  it('admits absent, invalid, future, and exactly day-old markers', () => {
    for (const value of [undefined, 'bad', '2026-10-10T00:00:00Z', '2026-10-08T00:00:00Z']) expect(releaseCheckDue(value, now)).toBe(true)
    expect(releaseCheckDue('2026-10-08T00:00:00.001Z', now)).toBe(false)
  })
  it('respects saved false and throttling, with manual bypass', async () => {
    for (const overrides of [{ enabled: () => false }, { lastAttempt: async () => new Date(now).toISOString() }]) {
      const { owner, io } = setup(overrides)
      await owner.check(false)
      expect(io.fetch).not.toHaveBeenCalled()
      await owner.check(true)
      expect(io.fetch).toHaveBeenCalledOnce()
      expect(io.present).toHaveBeenCalledWith({ kind: 'current' })
    }
  })
  it('is quiet for automatic current and failures; reports manual failures', async () => {
    const current = setup()
    await current.owner.check(false)
    await current.owner.check(false)
    expect(current.io.fetch).toHaveBeenCalledOnce()
    expect(current.io.present).not.toHaveBeenCalled()
    const failed = setup({ fetch: vi.fn(async () => { throw new Error('offline') }) })
    await failed.owner.check(false)
    expect(failed.io.present).not.toHaveBeenCalled()
    expect(failed.io.log).toHaveBeenCalledOnce()
    await failed.owner.check(true)
    expect(failed.io.present).toHaveBeenCalledWith({ kind: 'failed' })
  })
  it('persists before requesting and presents one available-release notice', async () => {
    const { owner, io } = setup({ installed: '1.0.0' })
    await owner.check(false)
    expect(io.saveAttempt).toHaveBeenCalledWith('2026-10-09T00:00:00.000Z')
    expect(io.saveAttempt.mock.invocationCallOrder[0]).toBeLessThan(io.fetch.mock.invocationCallOrder[0])
    expect(io.present).toHaveBeenCalledExactlyOnceWith({ kind: 'newer', version: 'v1.2.0' })
  })
  it('skips automatic requests when marker save fails, but manual proceeds', async () => {
    const { owner, io } = setup({ saveAttempt: vi.fn(async () => { throw new Error('disk') }) })
    await owner.check(false)
    expect(io.fetch).not.toHaveBeenCalled()
    await owner.check(true)
    expect(io.fetch).toHaveBeenCalledOnce()
  })
  it('a manual join promotes the pending operation even when its marker save fails', async () => {
    let reject!: (error: Error) => void
    const { owner, io } = setup({ saveAttempt: vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail })) })
    const automatic = owner.check(false)
    await vi.waitFor(() => expect(io.saveAttempt).toHaveBeenCalledOnce())
    const manual = owner.check(true)
    expect(manual).toBe(automatic)
    reject(new Error('disk'))
    await manual
    expect(io.fetch).toHaveBeenCalledOnce()
    expect(io.present).toHaveBeenCalledExactlyOnceWith({ kind: 'current' })
  })
})
