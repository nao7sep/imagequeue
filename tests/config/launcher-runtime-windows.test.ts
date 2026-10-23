import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Directly executed ESM helper.
import { listProcesses } from '../../scripts/launcher-processes.mjs'

describe('Windows launcher identities', () => {
  it('uses native creation identity and never a command line or taskkill', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: JSON.stringify([
      { ProcessId: 10, ParentProcessId: 1, Created: '2026-10-24T10:20:30.1234567Z' },
      { ProcessId: 11, ParentProcessId: 10, Created: '2026-10-24T10:20:31.1234567Z' },
    ]) })
    expect(await listProcesses('win32', run)).toEqual([
      { pid: 10, parentPid: 1, created: '2026-10-24T10:20:30.1234567Z' },
      { pid: 11, parentPid: 10, created: '2026-10-24T10:20:31.1234567Z' },
    ])
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]![1].join(' ')).toContain('$ErrorActionPreference = "Stop"')
    expect(run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-NonInteractive', '-Command', expect.stringContaining('CreationDate.ToUniversalTime()')]), expect.objectContaining({ timeout: 10000 }))
    expect(run.mock.calls[0]![1].join(' ')).not.toMatch(/CommandLine|ExecutablePath|Stop-Process|taskkill/)
  })
  it('accepts the single-row and empty PowerShell JSON shapes', async () => {
    const run = vi.fn().mockResolvedValueOnce({ stdout: JSON.stringify({ ProcessId: 10, ParentProcessId: 1, Created: 'stamp' }) }).mockResolvedValueOnce({ stdout: '' })
    expect(await listProcesses('win32', run)).toEqual([{ pid: 10, parentPid: 1, created: 'stamp' }])
    expect(await listProcesses('win32', run)).toEqual([])
  })
  it('propagates native observation errors', async () => {
    await expect(listProcesses('win32', vi.fn().mockRejectedValue(new Error('CIM denied')))).rejects.toThrow('CIM denied')
  })
})
