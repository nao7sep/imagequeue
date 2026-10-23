import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn }))
// @ts-expect-error Directly executed ESM helper.
import { LauncherRuntime, handshakePath } from '../../scripts/launcher-runtime.mjs'
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'imagequeue-start-test-')); spawn.mockReset() })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

function fixture(publish = true, status = 'ready') {
  const child = Object.assign(new EventEmitter(), { pid: 100, unref: vi.fn() })
  spawn.mockReturnValue(child)
  let clock = 0
  const control = vi.fn(async () => ({ pid: 101, status }))
  const runtime = new LauncherRuntime({ directory, control, now: () => clock,
    processes: async () => [{ pid: 100, parentPid: 1, created: 'dev' }, { pid: 101, parentPid: 100, created: 'main' }],
    sleep: async (ms: number) => {
      clock += ms
      if (publish) {
        const { token } = await runtime.read()
        await writeFile(handshakePath(token, directory), JSON.stringify({ token, pid: 101, port: 12345 }))
      }
    },
  })
  return { runtime, child, control }
}

describe('launcher startup readiness', () => {
  it('keeps the dev helper referenced after exact-generation readiness', async () => {
    const { runtime, child, control } = fixture()
    const result = await runtime.start('node', ['dev'], { development: true, timeout: 200 })
    expect((await runtime.read()).phase).toBe('ready')
    expect(control).toHaveBeenCalledWith(expect.objectContaining({ token: result.token }), 'status')
    expect(spawn).toHaveBeenCalledWith('node', ['dev'], expect.objectContaining({ detached: true, env: expect.objectContaining({ IMAGEQUEUE_LAUNCH_TOKEN: result.token }) }))
    expect(child.unref).not.toHaveBeenCalled()
    child.emit('exit', 0)
    await expect(result.exited).resolves.toBe(0)
  })
  it('releases the helper after a packaged start', async () => {
    const { runtime, child } = fixture()
    await runtime.start('ImageQueue', [], { timeout: 200 })
    expect(child.unref).toHaveBeenCalledOnce()
  })
  it('never treats a different running app as a ready launch without its handshake', async () => {
    const { runtime, child, control } = fixture(false)
    await expect(runtime.start('ImageQueue', [], { timeout: 200 })).rejects.toThrow('did not become ready')
    expect(control).not.toHaveBeenCalled()
    expect((await runtime.read()).phase).toBe('starting')
    expect(child.unref).toHaveBeenCalledOnce()
  })
  it('reports explicit startup failure without claiming readiness or removing live ownership', async () => {
    const { runtime, child } = fixture(true, 'failed')
    await expect(runtime.start('ImageQueue', [], { timeout: 200 })).rejects.toThrow('startup failure')
    expect(await runtime.read()).not.toBeNull()
    expect(child.unref).toHaveBeenCalledOnce()
  })
})
