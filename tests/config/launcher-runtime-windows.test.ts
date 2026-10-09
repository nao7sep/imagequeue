import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => {
  vi.resetModules()
  execute.mockReset()
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  process.argv = [process.execPath, scriptPath, 'stop', 'electron', 'ImageQueue', 'ImageQueue']
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  process.argv = originalArgv
  vi.restoreAllMocks()
})

function rows() {
  return [
    // The launching process and its ancestors are never replacement targets.
    { ProcessId: process.pid, ParentProcessId: 1, ExecutablePath: process.execPath, CommandLine: scriptPath },
    { ProcessId: 10, ParentProcessId: 1, ExecutablePath: `${repoRoot}\\dist\\win-unpacked\\ImageQueue.exe`, CommandLine: '' },
    { ProcessId: 11, ParentProcessId: 10, ExecutablePath: 'C:\\Windows\\System32\\child.exe', CommandLine: '' },
    { ProcessId: 20, ParentProcessId: 1, ExecutablePath: 'C:\\other\\ImageQueue.exe', CommandLine: '' },
  ]
}

describe('Windows launcher stop orchestration', () => {
  it('lists native processes and stops only the owned runtime tree', async () => {
    let lists = 0
    execute.mockImplementation(async (file: string) => {
      if (file === 'powershell.exe') return { stdout: JSON.stringify(lists++ === 0 ? rows() : []) }
      if (file === 'taskkill.exe') return { stdout: '' }
      throw new Error(`Unexpected executable: ${file}`)
    })
    // Run the real CLI entry point, with only its OS process adapter replaced.
    // @ts-expect-error Plain ESM launcher has no declaration file.
    await import('../../scripts/launcher-runtime.mjs')
    await vi.waitFor(() => expect(lists).toBe(2))
    const kills = execute.mock.calls.filter(([file]) => file === 'taskkill.exe')
    expect(kills.map(([, args]) => args)).toEqual([['/PID', '10', '/T']])
    expect(execute.mock.calls[0]![1]).toEqual(expect.arrayContaining([
      '-NonInteractive', '-Command', expect.stringContaining('Get-CimInstance Win32_Process'),
    ]))
  })

  it('rechecks ownership before a forced tree stop after the grace period', async () => {
    execute.mockImplementation(async (file: string) => {
      if (file === 'powershell.exe') return { stdout: JSON.stringify(rows()) }
      if (file === 'taskkill.exe') return { stdout: '' }
      throw new Error(`Unexpected executable: ${file}`)
    })
    // Pass the owning algorithm's grace period without sleeping or extending
    // a test limit. This verifies command routing, not Windows kernel behavior.
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(6_000)
    // @ts-expect-error Plain ESM launcher has no declaration file.
    await import('../../scripts/launcher-runtime.mjs')
    await vi.waitFor(() => expect(execute.mock.calls.filter(([file]) => file === 'taskkill.exe')).toHaveLength(2))
    const kills = execute.mock.calls.filter(([file]) => file === 'taskkill.exe')
    expect(kills.map(([, args]) => args)).toEqual([['/PID', '10', '/T'], ['/PID', '10', '/T', '/F']])
  })

  it('does not force-kill a PID that now belongs to another executable', async () => {
    let lists = 0
    execute.mockImplementation(async (file: string) => {
      if (file === 'powershell.exe') return { stdout: JSON.stringify(lists++ === 0 ? rows() : {
        ProcessId: 10, ParentProcessId: 1, ExecutablePath: 'C:\\other\\ImageQueue.exe', CommandLine: '',
      }) }
      if (file === 'taskkill.exe') return { stdout: '' }
      throw new Error(`Unexpected executable: ${file}`)
    })
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(6_000)
    // @ts-expect-error Plain ESM launcher has no declaration file.
    await import('../../scripts/launcher-runtime.mjs')
    await vi.waitFor(() => expect(lists).toBe(2))
    expect(execute.mock.calls.filter(([file]) => file === 'taskkill.exe').map(([, args]) => args))
      .toEqual([['/PID', '10', '/T']])
  })
})
