import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Directly executed ESM helper.
import { LauncherRuntime, handshakePath } from '../../scripts/launcher-runtime.mjs'

type Process = { pid: number; parentPid: number; created: string }
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'imagequeue-launcher-test-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

async function fixture(rows: Process[] = [{ pid: 10, parentPid: 1, created: 'root' }]) {
  let clock = 0
  const processes = vi.fn(async () => rows)
  const control = vi.fn(async (_endpoint: unknown, command: string) => {
    if (command === 'status') throw new Error('old endpoint is closed')
    return { status: 'quitting', pid: 10 }
  })
  const runtime = new LauncherRuntime({ directory, processes, control, now: () => clock, sleep: async (ms: number) => { clock += ms } })
  const token = randomUUID()
  await runtime.save({ token, phase: 'ready', processes: [{ pid: 10, created: 'root' }] })
  await writeFile(handshakePath(token, directory), JSON.stringify({ token, pid: 10, port: 12345 }))
  return { runtime, token, processes, control }
}

describe('generation-owned ordinary replacement', () => {
  it('requests normal Quit and removes only its own record after confirmed exit', async () => {
    const { runtime, token, processes, control } = await fixture()
    processes.mockResolvedValueOnce([{ pid: 10, parentPid: 1, created: 'root' }]).mockResolvedValue([])
    const unrelated = join(directory, 'other-app.json')
    await writeFile(unrelated, 'untouched')
    await runtime.stopIfOwner(token)
    expect(control).toHaveBeenCalledWith({ token, pid: 10, port: 12345 }, 'quit')
    expect(await runtime.read()).toBeNull()
    expect(await readFile(unrelated, 'utf8')).toBe('untouched')
    expect(await readdir(directory)).toEqual(['other-app.json'])
  })
  it('reports veto or surviving descendants and retains them after the root exits', async () => {
    const { runtime, token, processes } = await fixture()
    processes.mockResolvedValueOnce([
      { pid: 10, parentPid: 1, created: 'root' },
      { pid: 11, parentPid: 10, created: 'child' },
    ]).mockResolvedValue([{ pid: 11, parentPid: 1, created: 'child' }])
    await expect(runtime.stopIfOwner(token, 200)).rejects.toThrow('still running')
    expect((await runtime.read()).processes).toContainEqual({ pid: 11, created: 'child' })
    processes.mockResolvedValue([])
    await runtime.stopIfOwner(token, 200)
    expect(await runtime.read()).toBeNull()
  })
  it('does not treat a failed Quit request as successful replacement', async () => {
    const { runtime, token, control } = await fixture()
    control.mockRejectedValue(new Error('connection refused'))
    await expect(runtime.stopIfOwner(token, 200)).rejects.toThrow('could not receive ordinary Quit')
    expect((await runtime.read()).token).toBe(token)
  })
  it('accepts disappearance during a failed Quit request only when all recorded processes exited', async () => {
    const { runtime, token, processes, control } = await fixture()
    control.mockRejectedValue(new Error('connection reset'))
    processes.mockResolvedValueOnce([{ pid: 10, parentPid: 1, created: 'root' }]).mockResolvedValue([])
    await runtime.stopIfOwner(token)
    expect(await runtime.read()).toBeNull()
  })
  it('ignores matching editor arguments and reused PIDs without sending any Quit', async () => {
    const { runtime, token, control } = await fixture([
      { pid: 10, parentPid: 1, created: 'new-editor' },
      { pid: 20, parentPid: 1, created: 'other-app' },
    ])
    await runtime.stopIfOwner(token)
    expect(control).not.toHaveBeenCalledWith(expect.anything(), 'quit')
    expect(await runtime.read()).toBeNull()
  })
  it('authenticates a reloaded main process even when its PID was reused', async () => {
    const { runtime, token, processes, control } = await fixture([{ pid: 10, parentPid: 1, created: 'reloaded' }])
    control.mockImplementation(async (_endpoint: unknown, command: string) => {
      if (command === 'quit') processes.mockResolvedValue([])
      return { pid: 10, status: command === 'status' ? 'ready' : 'quitting' }
    })
    await runtime.stopIfOwner(token)
    expect(control.mock.calls.map(([, command]) => command)).toEqual(['status', 'quit'])
    expect(await runtime.read()).toBeNull()
  })
  it('does not enumerate or close a replacement from stale cleanup', async () => {
    const { runtime, processes, control } = await fixture()
    await runtime.stopIfOwner(randomUUID())
    expect(processes).not.toHaveBeenCalled()
    expect(control).not.toHaveBeenCalled()
    expect(await runtime.read()).not.toBeNull()
  })
  it('holds replacement ownership across awaited enumeration', async () => {
    const { runtime, token, processes } = await fixture()
    let release!: (rows: Process[]) => void
    processes.mockImplementationOnce(() => new Promise<Process[]>((resolve) => { release = resolve }))
    const stopped = runtime.stopIfOwner(token)
    await vi.waitFor(() => expect(processes).toHaveBeenCalledOnce())
    const contender = new LauncherRuntime({ directory })
    const replace = vi.fn()
    await expect(contender.exclusive(replace)).rejects.toThrow('in progress')
    expect(replace).not.toHaveBeenCalled()
    release([])
    await stopped
    await contender.exclusive(async () => contender.save({ token: 'replacement', phase: 'ready', processes: [] }))
    await runtime.stopIfOwner(token)
    expect((await runtime.read()).token).toBe('replacement')
  })
  it('refuses unknown interrupted startup instead of deleting its ownership evidence', async () => {
    const runtime = new LauncherRuntime({ directory, processes: async () => [] })
    const token = randomUUID()
    await runtime.save({ token, phase: 'starting', processes: [] })
    await expect(runtime.stopIfOwner(token)).rejects.toThrow('unknown outcome')
    expect((await runtime.read()).token).toBe(token)
  })
})
