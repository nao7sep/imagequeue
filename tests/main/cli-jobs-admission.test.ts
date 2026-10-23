import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  pipes: [] as Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }>,
  imports: [] as Array<{ kill: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; data: (text: string) => void; exit: (code?: number) => void }>,
  records: [] as Array<{ jobId: string; append: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> }>,
  closeOnKill: false,
  acceptOutput: true,
  resumes: [] as Array<() => void>,
  importFails: false,
}))
vi.mock('node:os', () => ({ availableParallelism: () => 6 }))
vi.mock('../../src/main/utils/owned-cli', () => ({
  CLI_HARD_KILL_DELAY_MS: 500,
  spawnOwnedCli: () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
    child.kill.mockImplementation(() => { if (fixtures.closeOnKill) child.emit('close', null, 'SIGTERM') })
    fixtures.pipes.push(child)
    return child
  },
}))
vi.mock('node-pty', () => ({
  spawn: () => {
    if (fixtures.importFails) throw new Error('PTY refused fixture')
    let dataListener: (text: string) => void = () => {}
    let exitListener: (event: { exitCode: number; signal: number }) => void = () => {}
    const child = {
      kill: vi.fn(() => { if (fixtures.closeOnKill) child.exit() }),
      exit: (exitCode = 0) => exitListener({ exitCode, signal: 0 }),
      pause: vi.fn(), resume: vi.fn(),
      data: (text: string) => dataListener(text),
      onData: (listener: typeof dataListener) => { dataListener = listener; return { dispose: vi.fn() } },
      onExit: (listener: typeof exitListener) => { exitListener = listener; return { dispose: vi.fn() } },
    }
    fixtures.imports.push(child)
    return child
  },
}))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
vi.mock('../../src/main/records', () => ({
  startCliJobRecord: ({ jobId }: { jobId: string }) => {
    const record = { jobId, append: vi.fn((_kind: string, _text: string, resume: () => void) => {
      if (!fixtures.acceptOutput) fixtures.resumes.push(resume)
      return fixtures.acceptOutput
    }), finish: vi.fn() }
    fixtures.records.push(record)
    return record
  },
}))

let scheduler: typeof import('../../src/main/cli-jobs')
let quit: typeof import('../../src/main/quit-state')
const start = (sourceIdentity: string, kind: 'download' | 'import' = 'download', modelsDir = '/models') => scheduler.startCliJob({
  kind, modelsDir, sourceIdentity, cliPath: '/fixture/cli', args: [sourceIdentity], target: sourceIdentity, logContext: {},
})
const status = (jobId: string) => scheduler.getCliJobSnapshot(jobId)?.status
const closePipe = (index: number) => fixtures.pipes[index]!.emit('close', 0, null)

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  fixtures.pipes.length = 0
  fixtures.imports.length = 0
  fixtures.records.length = 0
  fixtures.closeOnKill = false
  fixtures.acceptOutput = true
  fixtures.resumes.length = 0
  fixtures.importFails = false
  scheduler = await import('../../src/main/cli-jobs')
  quit = await import('../../src/main/quit-state')
  quit.setQuitting(false)
})
afterEach(async () => {
  quit.setQuitting(true)
  fixtures.closeOnKill = true
  for (const child of fixtures.pipes) child.emit('close', null, 'SIGKILL')
  for (const child of fixtures.imports) child.exit()
  await scheduler.killAllCliJobsAndWait()
  vi.advanceTimersByTime(10 * 60_000)
  vi.useRealTimers()
})

describe('CLI job admission and settlement', () => {
  it('bounds downloads by half the available CPU capacity and promotes in FIFO order', () => {
    expect(scheduler.CLI_DOWNLOAD_CONCURRENCY).toBe(3)
    const ids = ['a', 'b', 'c', 'd', 'e'].map((source) => start(source))
    expect(ids.map(status)).toEqual(['running', 'running', 'running', 'queued', 'queued'])
    closePipe(0)
    expect(ids.map(status)).toEqual(['exited', 'running', 'running', 'running', 'queued'])
    closePipe(1)
    expect(status(ids[4]!)).toBe('running')
  })

  it.each(['append', 'replace', 'terminal'] as const)('isolates a failed %s notification from capture, promotion and settlement', async (phase) => {
    const first = start('a')
    start('b'); start('c')
    const queued = start('d')
    const pipe = fixtures.pipes[0]!
    if (phase === 'replace') pipe.stdout.write('one\r')
    const broken = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn(() => { throw new Error('frame unavailable') }) })
    const healthy = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
    scheduler.subscribeCliJob(first, broken as unknown as WebContents)
    scheduler.subscribeCliJob(first, healthy as unknown as WebContents)
    if (phase !== 'terminal') {
      expect(() => pipe.stdout.write(phase === 'replace' ? 'two\r' : 'two\n')).not.toThrow()
      expect(fixtures.records[0]!.append).toHaveBeenCalled()
      expect(healthy.send).toHaveBeenCalledWith('cli-job:chunk', expect.objectContaining({ chunk: expect.objectContaining({ text: 'two' }) }))
    }
    expect(() => closePipe(0)).not.toThrow()
    expect(broken.send).toHaveBeenCalledOnce()
    expect(broken.listenerCount('destroyed')).toBe(0)
    expect(healthy.send).toHaveBeenCalledWith('cli-job:status', expect.objectContaining({ status: 'exited' }))
    expect(fixtures.records[0]!.finish).toHaveBeenCalledOnce()
    expect(status(queued)).toBe('running')
    fixtures.closeOnKill = true
    await expect(scheduler.killAllCliJobsAndWait()).resolves.toMatchObject({ settled: true })
  })

  it('coalesces exact active, queued and stopping work, then admits a fresh job after close', () => {
    const first = start('a')
    expect(start('a')).toBe(first)
    start('b'); start('c')
    const queued = start('d')
    expect(start('d')).toBe(queued)
    scheduler.killCliJob(first)
    expect(status(first)).toBe('stopping')
    expect(start('a')).toBe(first)
    expect(status(queued)).toBe('queued')
    expect(scheduler.hasRunningCliJobs()).toBe(true)
    closePipe(0)
    expect(status(first)).toBe('killed')
    expect(status(queued)).toBe('running')
    expect(start('a')).not.toBe(first)
    expect(start('a', 'download', '/other')).not.toBe(first)
  })

  it('holds an import directory exclusively and prevents later same-directory downloads overtaking it', () => {
    const download = start('a')
    const waitingImport = start('artifact', 'import')
    const laterDownload = start('b')
    const independent = start('c', 'download', '/other')
    expect([download, waitingImport, laterDownload, independent].map(status)).toEqual(['running', 'queued', 'queued', 'running'])
    closePipe(0)
    expect(status(waitingImport)).toBe('running')
    expect(status(laterDownload)).toBe('queued')
    expect(start('another-artifact', 'import', '/third')).toBeTruthy()
    expect(fixtures.imports).toHaveLength(1)
    scheduler.killCliJob(waitingImport)
    expect(status(laterDownload)).toBe('queued')
    fixtures.imports[0]!.exit()
    expect(status(laterDownload)).toBe('running')
    expect(fixtures.imports).toHaveLength(2)
  })

  it('preserves a physical slot after a pipe error until its actual close', () => {
    const first = start('a')
    start('b'); start('c')
    const queued = start('d')
    const failure = Object.assign(new Error('spawn refused'), { code: 'ENOENT' })
    fixtures.pipes[0]!.emit('error', failure)
    expect(status(first)).toBe('running')
    expect(status(queued)).toBe('queued')
    expect(fixtures.records[0]!.finish).not.toHaveBeenCalled()
    closePipe(0)
    expect(status(queued)).toBe('running')
    expect(fixtures.records[0]!.finish).toHaveBeenCalledWith(expect.objectContaining({ exitCode: null, error: failure }))
  })

  it('settles a PTY creation failure immediately because there is no child to reserve', () => {
    fixtures.importFails = true
    const failed = start('artifact', 'import')
    expect(status(failed)).toBe('exited')
    expect(scheduler.hasRunningCliJobs()).toBe(false)
    expect(fixtures.records[0]!.finish).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }))
  })

  it('signals the entire shutdown snapshot without promoting queued work during synchronous closes', async () => {
    const active = start('artifact', 'import')
    const queued = start('second-artifact', 'import', '/second')
    const download = start('d', 'download', '/third')
    fixtures.closeOnKill = true
    await expect(scheduler.killAllCliJobsAndWait()).resolves.toEqual({ signalled: 3, settled: true })
    expect([active, queued, download].map(status)).toEqual(['killed', 'killed', 'killed'])
    expect(fixtures.imports).toHaveLength(1)
    expect(fixtures.pipes).toHaveLength(1)
    expect(scheduler.hasRunningCliJobs()).toBe(false)
  })

  it('keeps a shutdown wait pending while an already-stopping child still owns its slot', async () => {
    const job = start('a')
    scheduler.killCliJob(job)
    let settled = false
    const barrier = scheduler.killAllCliJobsAndWait().then((result) => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(scheduler.hasRunningCliJobs()).toBe(true)
    closePipe(0)
    expect(await barrier).toEqual({ signalled: 1, settled: true })
    expect(scheduler.hasRunningCliJobs()).toBe(false)
    vi.advanceTimersByTime(500)
    expect(fixtures.pipes[0]!.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  })

  it('blocks admission and promotion once quitting starts', () => {
    const active = start('artifact', 'import')
    const queued = start('other', 'import', '/other')
    quit.setQuitting(true)
    fixtures.imports[0]!.exit()
    expect(status(active)).toBe('exited')
    expect(status(queued)).toBe('queued')
    expect(() => start('never')).toThrow('quitting')
    expect(fixtures.imports).toHaveLength(1)
  })

  it('resets download inactivity from either stream, independently of the stall indicator', () => {
    const first = start('a')
    start('b'); start('c')
    const queued = start('d')
    vi.advanceTimersByTime(60_000)
    expect(status(first)).toBe('stalled')
    fixtures.pipes[0]!.stderr.write('activity\n')
    expect(status(first)).toBe('running')
    vi.advanceTimersByTime(scheduler.CLI_DOWNLOAD_INACTIVITY_TIMEOUT_MS - 1)
    expect(status(first)).toBe('stalled')
    fixtures.pipes[0]!.stdout.write('more activity\n')
    vi.advanceTimersByTime(scheduler.CLI_DOWNLOAD_INACTIVITY_TIMEOUT_MS - 1)
    expect(status(first)).toBe('stalled')
    vi.advanceTimersByTime(1)
    expect(status(first)).toBe('stopping')
    expect(status(queued)).toBe('queued')
    expect(fixtures.pipes[0]!.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    vi.advanceTimersByTime(500)
    expect(fixtures.pipes[0]!.kill).toHaveBeenLastCalledWith('SIGKILL')
    expect(status(first)).toBe('stopping')
    closePipe(0)
    expect(status(first)).toBe('timed-out')
    expect(status(queued)).toBe('running')
    expect(fixtures.records[0]!.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'timed-out', error: expect.any(Error) }))
  })

  it('pauses and resumes each exact source independently and settles the process while output is still pending', () => {
    const pipeJob = start('a')
    const ptyJob = start('artifact', 'import', '/other')
    fixtures.acceptOutput = false
    const pipe = fixtures.pipes[0]!
    pipe.stdout.write('stdout waiting\n')
    pipe.stderr.write('stderr waiting\n')
    fixtures.imports[0]!.data('pty waiting\n')
    expect(pipe.stdout.isPaused()).toBe(true)
    expect(pipe.stderr.isPaused()).toBe(true)
    expect(fixtures.imports[0]!.pause).toHaveBeenCalledOnce()
    fixtures.resumes[0]!()
    expect(pipe.stdout.isPaused()).toBe(false)
    expect(pipe.stderr.isPaused()).toBe(true)
    closePipe(0)
    fixtures.imports[0]!.exit()
    expect(status(pipeJob)).toBe('exited')
    expect(status(ptyJob)).toBe('exited')
    expect(() => { fixtures.resumes[1]!(); fixtures.resumes[2]!() }).not.toThrow()
    expect(fixtures.imports[0]!.resume).toHaveBeenCalledOnce()
  })

  it('bounds long newline-free presentation segments and retains only the live line ring', () => {
    const job = start('a')
    const pipe = fixtures.pipes[0]!
    pipe.stdout.write('x'.repeat(1024 * 1024) + '\r\n')
    expect(scheduler.getCliJobSnapshot(job)!.chunks.every((chunk) => chunk.text.length <= 16 * 1024)).toBe(true)
    for (let index = 0; index < 2100; index++) pipe.stdout.write(`line ${index}\n`)
    closePipe(0)
    const snapshot = scheduler.getCliJobSnapshot(job)!
    expect(snapshot.chunks).toHaveLength(2000)
    expect(snapshot.chunks[0]!.text).toBe('line 100')
    expect(snapshot.chunks.at(-1)!.text).toBe('line 2099')
  })

  it('allows quiet imports their absolute conversion budget, then releases the next only after exit', () => {
    const first = start('artifact', 'import')
    const next = start('next', 'import', '/other')
    vi.advanceTimersByTime(scheduler.CLI_DOWNLOAD_INACTIVITY_TIMEOUT_MS + 1)
    expect(status(first)).toBe('running')
    expect(fixtures.imports[0]!.kill).not.toHaveBeenCalled()
    vi.advanceTimersByTime(scheduler.CLI_IMPORT_TIMEOUT_MS - scheduler.CLI_DOWNLOAD_INACTIVITY_TIMEOUT_MS - 1)
    expect(status(first)).toBe('stopping')
    expect(status(next)).toBe('queued')
    vi.advanceTimersByTime(500)
    expect(fixtures.imports[0]!.kill.mock.calls.map((call) => call[0])).toEqual(['SIGTERM', 'SIGKILL'])
    expect(status(next)).toBe('queued')
    fixtures.imports[0]!.exit()
    expect(status(first)).toBe('timed-out')
    expect(status(next)).toBe('running')
  })
})
