import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Directly executed ESM helper.
import { listProcesses, retainProcessTree, liveRecorded } from '../../scripts/launcher-processes.mjs'

describe('POSIX launcher identities', () => {
  it('reads creation stamps without matching executable or editor arguments', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '  10 1 Sat Oct 24 10:20:30 2026\n 11 10 Sat Oct 24 10:20:31 2026\n' })
    const rows = await listProcesses('darwin', run)
    expect(rows).toEqual([
      { pid: 10, parentPid: 1, created: 'Sat Oct 24 10:20:30 2026' },
      { pid: 11, parentPid: 10, created: 'Sat Oct 24 10:20:31 2026' },
    ])
    expect(run).toHaveBeenCalledWith('ps', ['-axo', 'pid=,ppid=,lstart='], expect.objectContaining({ timeout: 5000, env: expect.objectContaining({ LC_ALL: 'C' }) }))
  })
  it('retains reparented children and never admits descendants of a reused PID', () => {
    const recorded = retainProcessTree([{ pid: 10, created: 'first' }], [
      { pid: 12, parentPid: 11, created: 'grandchild' },
      { pid: 11, parentPid: 10, created: 'child' },
      { pid: 10, parentPid: 1, created: 'first' },
    ])
    const current = [
      { pid: 10, parentPid: 1, created: 'replacement' },
      { pid: 11, parentPid: 1, created: 'child' },
      { pid: 13, parentPid: 10, created: 'unrelated' },
    ]
    expect(retainProcessTree(recorded, current)).toEqual(recorded)
    expect(liveRecorded(recorded, current)).toEqual([current[1]])
  })
  it('propagates failed process observations instead of claiming everything exited', async () => {
    await expect(listProcesses('darwin', vi.fn().mockRejectedValue(new Error('ps denied')))).rejects.toThrow('ps denied')
  })
})
