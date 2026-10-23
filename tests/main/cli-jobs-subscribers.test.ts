import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCliJobSnapshot, startCliJob, subscribeCliJob, unsubscribeCliJob } from '../../src/main/cli-jobs'
import { CLI_JOB_RETENTION_AFTER_EXIT_MS } from '../../src/shared/cli-jobs'

const children: EventEmitter[] = []
vi.mock('../../src/main/utils/owned-cli', () => ({
  CLI_HARD_KILL_DELAY_MS: 500,
  spawnOwnedCli: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    })
    children.push(child)
    return child
  },
}))
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: vi.fn() }))
vi.mock('../../src/main/records', () => ({ startCliJobRecord: () => ({ finish: vi.fn() }) }))

const start = (): string => startCliJob({
  kind: 'download', modelsDir: '/test/models', sourceIdentity: 'model.ckpt', cliPath: '/fake/cli', args: [], target: 'model', logContext: {},
})
const subscriber = () => Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
const webContents = (sender: ReturnType<typeof subscriber>): WebContents => sender as unknown as WebContents

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const child of children.splice(0)) child.emit('close', 0, null)
  vi.advanceTimersByTime(CLI_JOB_RETENTION_AFTER_EXIT_MS)
  vi.useRealTimers()
})

describe('CLI job subscriber lifetime', () => {
  it('deduplicates subscriptions and detaches on every unsubscribe', () => {
    const jobId = start()
    const sender = subscriber()
    for (let cycle = 0; cycle < 20; cycle++) {
      subscribeCliJob(jobId, webContents(sender))
      subscribeCliJob(jobId, webContents(sender))
      expect(sender.listenerCount('destroyed')).toBe(1)
      unsubscribeCliJob(jobId, webContents(sender))
      expect(sender.listenerCount('destroyed')).toBe(0)
    }
  })

  it('releases callbacks and job state at retention expiry', () => {
    const jobId = start()
    const first = subscriber()
    const second = subscriber()
    subscribeCliJob(jobId, webContents(first))
    subscribeCliJob(jobId, webContents(second))
    children.at(-1)!.emit('close', 0, null)
    expect(getCliJobSnapshot(jobId)?.status).toBe('exited')
    vi.advanceTimersByTime(CLI_JOB_RETENTION_AFTER_EXIT_MS)
    expect(first.listenerCount('destroyed')).toBe(0)
    expect(second.listenerCount('destroyed')).toBe(0)
    expect(getCliJobSnapshot(jobId)).toBeNull()
    expect(subscribeCliJob(jobId, webContents(first))).toBeNull()
    first.emit('destroyed')
    second.emit('destroyed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes destroyed subscribers and retains no job after the shorter expiry', () => {
    const jobId = start()
    const sender = subscriber()
    subscribeCliJob(jobId, webContents(sender))
    children.at(-1)!.emit('close', 0, null)
    sender.emit('destroyed')
    expect(sender.listenerCount('destroyed')).toBe(0)
    vi.advanceTimersByTime(30_000)
    expect(getCliJobSnapshot(jobId)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
