import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('node:child_process', () => {
  const execFile = Object.assign(() => {}, {
    [Symbol.for('nodejs.util.promisify.custom')]: execute,
  })
  return { execFile }
})

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const originalArgv = process.argv
const scriptPath = fileURLToPath(new URL('../../scripts/launcher-runtime.mjs', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/[/\\]$/, '')
let kill: MockInstance<typeof process.kill>

beforeEach(() => {
  vi.resetModules()
  execute.mockReset()
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  process.argv = [process.execPath, scriptPath, 'stop', 'electron', 'ImageQueue', 'ImageQueue']
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  // Signals are recorded, never delivered.
  kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  process.argv = originalArgv
  vi.restoreAllMocks()
})

// `ps -axo pid=,ppid=,command=` output: the launching process and its parent,
// the owned bundle with a helper child, and an unrelated ImageQueue elsewhere.
function ps(rows: string[] = [
  `${process.pid} 1 node ${scriptPath} stop electron ImageQueue ImageQueue`,
  `10 1 ${repoRoot}/dist/mac-arm64/ImageQueue.app/Contents/MacOS/ImageQueue`,
  `11 10 /usr/libexec/helper --type=renderer`,
  `20 1 /Applications/ImageQueue.app/Contents/MacOS/ImageQueue`,
]): { stdout: string } {
  return { stdout: `${rows.join('\n')}\n` }
}

const signals = (signal: string): unknown[] => kill.mock.calls.filter(([, sent]) => sent === signal).map(([pid]) => pid)

describe('macOS launcher stop orchestration', () => {
  it('terminates only the owned runtime tree', async () => {
    let lists = 0
    execute.mockImplementation(async (file: string) => {
      if (file === 'ps') return lists++ === 0 ? ps() : ps([])
      throw new Error(`Unexpected executable: ${file}`)
    })
    // Run the real CLI entry point, with only its OS process adapter replaced.
    // @ts-expect-error Plain ESM launcher has no declaration file.
    await import('../../scripts/launcher-runtime.mjs')
    await vi.waitFor(() => expect(lists).toBe(2))
    expect(execute.mock.calls[0]![1]).toEqual(['-axo', 'pid=,ppid=,command='])
    expect(signals('SIGTERM').sort()).toEqual([10, 11])
    expect(signals('SIGKILL')).toEqual([])
    expect(kill).not.toHaveBeenCalledWith(process.pid, expect.anything())
  })

  it('force-stops a tree that outlives the grace period after rechecking ownership', async () => {
    execute.mockImplementation(async (file: string) => {
      if (file === 'ps') return ps()
      throw new Error(`Unexpected executable: ${file}`)
    })
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(6_000)
    // @ts-expect-error Plain ESM launcher has no declaration file.
    await import('../../scripts/launcher-runtime.mjs')
    await vi.waitFor(() => expect(signals('SIGKILL')).toHaveLength(2))
    expect(signals('SIGKILL').sort()).toEqual([10, 11])
    expect(signals('SIGTERM').sort()).toEqual([10, 11])
  })

  it('does not force-kill a PID that now belongs to another program', async () => {
    let lists = 0
    execute.mockImplementation(async (file: string) => {
      if (file === 'ps') return lists++ === 0 ? ps() : ps([`10 1 /usr/bin/unrelated`])
      throw new Error(`Unexpected executable: ${file}`)
    })
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(6_000)
    // @ts-expect-error Plain ESM launcher has no declaration file.
    await import('../../scripts/launcher-runtime.mjs')
    await vi.waitFor(() => expect(lists).toBe(2))
    expect(signals('SIGTERM').sort()).toEqual([10, 11])
    expect(signals('SIGKILL')).toEqual([])
  })
})
