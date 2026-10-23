import { availableParallelism } from 'node:os'
import { spawnOwnedCli, CLI_HARD_KILL_DELAY_MS } from './utils/owned-cli'
import { assertNotQuitting, isQuitting } from './quit-state'
import type { WebContents } from 'electron'
import { nanoid } from 'nanoid'
import { spawn as spawnPty } from 'node-pty'
import { log, serializeError } from './logger'
import { startCliJobRecord, type CliJobRecord } from './records'
import { cliJobStartFailurePresentation } from './failure-presentation'
import { waitForAllSettledWithin } from './utils/bounded-wait'
import {
  CliChunk,
  CliChunkEvent,
  CliJobKind,
  CliJobSnapshot,
  CliJobStatus,
  CliStatusEvent,
  CLI_JOB_BUFFER_MAX_LINES,
  CLI_JOB_RETENTION_AFTER_EXIT_MS,
  CLI_JOB_STALL_THRESHOLD_MS,
} from '../shared/cli-jobs'

interface StartCliJobOpts {
  kind: CliJobKind
  cliPath: string
  args: string[]
  target: string
  logContext: Record<string, unknown>
  modelsDir: string
  sourceIdentity: string
}

interface JobState {
  jobId: string
  kind: CliJobKind
  target: string
  modelsDir: string
  sourceIdentity: string
  deadlineTimer: NodeJS.Timeout | null
  stopReason: 'killed' | 'timed-out' | null
  processError?: unknown
  startedAtMs: number
  child: { kill(signal?: string): void } | null
  buffer: CliChunk[]
  nextSeq: number
  subscribers: Set<WebContents>
  subscriberDestroyed: Map<WebContents, () => void>
  status: CliJobStatus
  exitCode: number | null
  stalled: boolean
  lastOutputMs: number
  stallTimer: NodeJS.Timeout | null
  killGraceTimer: NodeJS.Timeout | null
  retentionTimer: NodeJS.Timeout | null
  stdoutFragment: string
  stderrFragment: string
  stdoutDelimiterCR: boolean
  stderrDelimiterCR: boolean
  stdoutLastCR: boolean
  stderrLastCR: boolean
  finalized: boolean
  settled: Promise<void>
  resolveSettled: () => void
  cliPath: string
  args: string[]
  logContext: Record<string, unknown>
  // The record owns streamed diagnostics; process settlement never waits for
  // optional output storage to finish.
  record: CliJobRecord
  processStartedAt: string | null
}

const jobs = new Map<string, JobState>()
const pendingJobIds: string[] = []
let draining = false
let drainDepth = 0
// Keep half the available CPU capacity for image generation and the interface.
export const CLI_DOWNLOAD_CONCURRENCY = Math.max(1, Math.floor(availableParallelism() / 2))
// Ten successive stall windows bound a silent download without treating each
// slow transfer as a failure. Imports can be quiet during heavy native work.
export const CLI_DOWNLOAD_INACTIVITY_TIMEOUT_MS = 10 * CLI_JOB_STALL_THRESHOLD_MS
// A generous unattended conversion budget, independent of download activity.
export const CLI_IMPORT_TIMEOUT_MS = 6 * 60 * 60_000
const CLI_JOB_RETENTION_WITHOUT_SUBSCRIBERS_MS = 30_000

export function startCliJob(opts: StartCliJobOpts): string {
  assertNotQuitting()
  for (const existing of jobs.values()) {
    if (!existing.finalized && existing.kind === opts.kind && existing.modelsDir === opts.modelsDir && existing.sourceIdentity === opts.sourceIdentity) return existing.jobId
  }
  const jobId = nanoid()
  let resolveSettled!: () => void
  const settled = new Promise<void>((resolve) => { resolveSettled = resolve })
  const state: JobState = {
    jobId,
    kind: opts.kind,
    target: opts.target,
    modelsDir: opts.modelsDir,
    sourceIdentity: opts.sourceIdentity,
    deadlineTimer: null,
    stopReason: null,
    startedAtMs: Date.now(),
    child: null,
    buffer: [],
    nextSeq: 0,
    subscribers: new Set(),
    subscriberDestroyed: new Map(),
    status: 'queued',
    exitCode: null,
    stalled: false,
    lastOutputMs: Date.now(),
    stallTimer: null,
    killGraceTimer: null,
    retentionTimer: null,
    stdoutFragment: '',
    stderrFragment: '',
    stdoutDelimiterCR: false,
    stderrDelimiterCR: false,
    stdoutLastCR: false,
    stderrLastCR: false,
    finalized: false,
    settled,
    resolveSettled,
    cliPath: opts.cliPath,
    args: opts.args,
    logContext: opts.logContext,
    record: startCliJobRecord({ jobId, kind: opts.kind, target: opts.target, cliPath: opts.cliPath, args: opts.args }),
    processStartedAt: null,
  }
  jobs.set(jobId, state)

  pendingJobIds.push(jobId)
  drainPendingJobs()

  return jobId
}

export function subscribeCliJob(jobId: string, wc: WebContents): CliJobSnapshot | null {
  const state = jobs.get(jobId)
  if (!state) return null
  if (!state.subscribers.has(wc)) {
    state.subscribers.add(wc)
    const onDestroyed = (): void => removeSubscriber(state, wc)
    state.subscriberDestroyed.set(wc, onDestroyed)
    wc.once('destroyed', onDestroyed)
  }
  clearRetentionTimer(state)
  return snapshot(state)
}

export function unsubscribeCliJob(jobId: string, wc: WebContents): void {
  const state = jobs.get(jobId)
  if (!state) return
  removeSubscriber(state, wc)
}

export function killCliJob(jobId: string, killGraceMs = CLI_HARD_KILL_DELAY_MS): void {
  const state = jobs.get(jobId)
  if (!state || state.finalized || state.status === 'stopping') return
  if (state.status === 'queued') {
    removePendingJob(jobId)
    finalize(state, 'killed', null)
    return
  }
  requestStop(state, 'killed', killGraceMs)
}

function requestStop(state: JobState, reason: 'killed' | 'timed-out', graceMs = CLI_HARD_KILL_DELAY_MS): void {
  if (state.finalized || state.status === 'stopping') return
  state.stopReason = reason
  state.status = 'stopping'
  state.stalled = false
  if (reason === 'timed-out') state.processError = new Error(state.kind === 'download'
    ? 'Model download exceeded the inactivity deadline'
    : 'Model import exceeded the conversion deadline')
  emitStatus(state)
  state.killGraceTimer = setTimeout(() => {
    if (!state.finalized) {
      try { state.child?.kill('SIGKILL') } catch { /* close remains authoritative */ }
    }
  }, graceMs)
  try { state.child?.kill('SIGTERM') } catch { /* close remains authoritative */ }
}

/** Signal every live/queued CLI job and await real child settlement, bounded. */
export async function killAllCliJobsAndWait(options: {
  killGraceMs?: number
  timeoutMs?: number
} = {}): Promise<{ signalled: number; settled: boolean }> {
  const killGraceMs = options.killGraceMs ?? CLI_HARD_KILL_DELAY_MS
  const timeoutMs = options.timeoutMs ?? killGraceMs + 2_000
  const active = [...jobs.values()].filter((state) => !state.finalized)

  // Queue cancellation can settle synchronously. Freeze promotion across the
  // whole snapshot so shutdown never launches work it has not signalled yet.
  drainDepth++
  try {
    for (const state of active) killCliJob(state.jobId, killGraceMs)
  } finally {
    drainDepth--
    drainPendingJobs()
  }

  return {
    signalled: active.length,
    settled: await waitForAllSettledWithin(active.map((state) => state.settled), timeoutMs),
  }
}

export function getCliJobSnapshot(jobId: string): CliJobSnapshot | null {
  const state = jobs.get(jobId)
  return state ? snapshot(state) : null
}

// Physical ownership includes queued work and a child still stopping.
export function hasRunningCliJobs(): boolean {
  return [...jobs.values()].some((state) => !state.finalized)
}

function drainPendingJobs(): void {
  if (draining || drainDepth > 0 || isQuitting()) return
  draining = true
  try {
    for (let index = 0; index < pendingJobIds.length;) {
      const state = jobs.get(pendingJobIds[index])!
      const active = [...jobs.values()].filter((job) => !job.finalized && job.status !== 'queued')
      const sameDirectory = active.filter((job) => job.modelsDir === state.modelsDir)
      const blockedByImport = pendingJobIds.slice(0, index).some((id) => {
        const earlier = jobs.get(id)!
        return earlier.kind === 'import' && earlier.modelsDir === state.modelsDir
      })
      const canStart = state.kind === 'import'
        ? !active.some((job) => job.kind === 'import') && sameDirectory.length === 0
        : active.filter((job) => job.kind === 'download').length < CLI_DOWNLOAD_CONCURRENCY
          && !sameDirectory.some((job) => job.kind === 'import' || job.sourceIdentity === state.sourceIdentity)
          && !blockedByImport
      if (!canStart) { index++; continue }
      pendingJobIds.splice(index, 1)
      state.status = 'running'
      launchJob(state)
    }
  } finally { draining = false }
}

// Two launch mechanisms, deliberately:
//   download (`models ensure`) → a plain pipe. The CLI flushes stdout after
//     each `\r` progress update, so progress streams fine over a pipe.
//   import (`models import`)    → a real PTY (node-pty). The import path uses
//     plain println()-style output and, without a controlling TTY, the CLI's
//     Swift/C runtime aborts before producing any output. node-pty allocates a
//     pseudo-terminal so it runs and streams. (An earlier attempt wrapped the
//     command in `/usr/bin/script` to fake a PTY, but that echoed a stray "^D"
//     into the log and fought with stdin; node-pty is the clean replacement.)
// Do NOT "simplify" import onto the pipe path — it will break imports entirely.
function launchJob(state: JobState): void {
  state.processStartedAt = new Date().toISOString()
  resetDeadline(state)
  if (state.kind === 'import') {
    launchImportJob(state)
    return
  }

  launchPipeJob(state)
}

function launchPipeJob(state: JobState): void {
  const child = spawnOwnedCli(state.cliPath, state.args)
  const { stdout, stderr } = child

  state.child = {
    kill: (signal?: string) => {
      child.kill(signal as NodeJS.Signals | undefined)
    },
  }
  state.lastOutputMs = Date.now()
  state.status = 'running'
  state.stalled = false

  stdout.setEncoding('utf8')
  stderr.setEncoding('utf8')
  stdout.on('data', (chunk: string) => {
    if (!onData(state, 'stdout', chunk, () => stdout.resume())) stdout.pause()
  })
  stderr.on('data', (chunk: string) => {
    if (!onData(state, 'stderr', chunk, () => stderr.resume())) stderr.pause()
  })

  child.on('error', (err) => {
    log('error', 'CLI job spawn error', { jobId: state.jobId, ...state.logContext, error: serializeError(err) })
    pushChunk(state, 'stderr', cliJobStartFailurePresentation(state.kind, err))
    state.processError = err
  })

  child.on('close', (code, signal) => {
    finalize(state, state.stopReason ?? 'exited', state.processError && !state.stopReason ? null : code, signal, state.processError)
  })

  if (state.kind === 'download') {
    state.stallTimer = setInterval(() => {
      if (state.status !== 'running' && state.status !== 'stalled') return
      const idle = Date.now() - state.lastOutputMs
      const nextStatus: CliJobStatus = idle >= CLI_JOB_STALL_THRESHOLD_MS ? 'stalled' : 'running'
      const nextStalled = nextStatus === 'stalled'
      if (state.status !== nextStatus || state.stalled !== nextStalled) {
        state.status = nextStatus
        state.stalled = nextStalled
        emitStatus(state)
      }
    }, 5_000)
  }

  emitStatus(state)
  log('info', 'CLI job started', {
    jobId: state.jobId,
    kind: state.kind,
    target: state.target,
    ...state.logContext,
  })
}

function launchImportJob(state: JobState): void {
  try {
    const ptyProcess = spawnPty(state.cliPath, state.args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    })

    let dataSubscription: { dispose(): void } | null = null
    let exitSubscription: { dispose(): void } | null = null

    state.child = {
      kill: (signal?: string) => {
        ptyProcess.kill(signal)
      },
    }
    state.lastOutputMs = Date.now()
    state.status = 'running'
    state.stalled = false

    dataSubscription = ptyProcess.onData((chunk) => {
      if (!onData(state, 'stdout', chunk, () => ptyProcess.resume())) ptyProcess.pause()
    })
    exitSubscription = ptyProcess.onExit(({ exitCode, signal }) => {
      dataSubscription?.dispose()
      exitSubscription?.dispose()
      // node-pty reports 0 when no signal ended the process.
      finalize(state, state.stopReason ?? 'exited', exitCode, signal === undefined || signal === 0 ? null : String(signal), state.processError)
    })

    emitStatus(state)
    log('info', 'CLI job started', {
      jobId: state.jobId,
      kind: state.kind,
      target: state.target,
      ptyPid: ptyProcess.pid,
      ...state.logContext,
    })
  } catch (err) {
    log('error', 'CLI PTY spawn error', { jobId: state.jobId, ...state.logContext, error: serializeError(err) })
    pushChunk(state, 'stderr', cliJobStartFailurePresentation(state.kind, err))
    finalize(state, state.stopReason ?? 'exited', null, null, err)
  }
}

function resetDeadline(state: JobState): void {
  if (state.deadlineTimer) clearTimeout(state.deadlineTimer)
  state.deadlineTimer = setTimeout(() => requestStop(state, 'timed-out'),
    state.kind === 'download' ? CLI_DOWNLOAD_INACTIVITY_TIMEOUT_MS : CLI_IMPORT_TIMEOUT_MS)
}

function onData(state: JobState, kind: 'stdout' | 'stderr', chunk: string, resume: () => void): boolean {
  if (state.finalized) return true
  const accepted = state.record.append(kind, chunk, resume)
  if (state.kind === 'download' && state.status !== 'stopping') resetDeadline(state)
  state.lastOutputMs = Date.now()
  if (state.kind === 'download') {
    if (state.status === 'stalled') {
      state.status = 'running'
      state.stalled = false
      emitStatus(state)
    }
  }
  // Live presentation is bounded independently of the complete diagnostic
  // stream. Scan once and split long logical lines rather than retaining them.
  const fragmentField = kind === 'stdout' ? 'stdoutFragment' : 'stderrFragment'
  const delimiterField = kind === 'stdout' ? 'stdoutDelimiterCR' : 'stderrDelimiterCR'
  let fragment = state[fragmentField]
  let previousCR = state[delimiterField]
  for (let index = 0; index < chunk.length; index++) {
    const char = chunk[index]
    if (char === '\r' || char === '\n') {
      if (!(char === '\n' && previousCR)) pushChunk(state, kind, stripAnsi(fragment), char === '\r')
      fragment = ''
      previousCR = char === '\r'
    } else {
      previousCR = false
      fragment += char
      if (fragment.length >= 16 * 1024 && !/[\uD800-\uDBFF]/.test(char)) {
        pushChunk(state, kind, stripAnsi(fragment))
        fragment = ''
      }
    }
  }
  state[fragmentField] = fragment
  state[delimiterField] = previousCR
  return accepted
}

function pushChunk(state: JobState, kind: 'stdout' | 'stderr', text: string, isCR = false): void {
  if (text.length === 0 && kind === 'stdout') return
  const lastCRKey = kind === 'stdout' ? 'stdoutLastCR' : 'stderrLastCR'

  if (isCR && state[lastCRKey] && state.buffer.length > 0) {
    const last = state.buffer[state.buffer.length - 1]
    if (last.kind === kind) {
      last.text = text
      last.tsMs = Date.now()
      const event: CliChunkEvent = { jobId: state.jobId, chunk: { ...last }, replace: true }
      notifySubscribers(state, 'cli-job:chunk', event)
      return
    }
  }

  if (!isCR && state.buffer.length > 0) {
    const last = state.buffer[state.buffer.length - 1]
    if (last.kind === kind && last.text === text) {
      state[lastCRKey] = false
      return
    }
  }

  state[lastCRKey] = isCR
  const chunk: CliChunk = { seq: state.nextSeq++, kind, text, tsMs: Date.now() }
  state.buffer.push(chunk)
  if (state.buffer.length > CLI_JOB_BUFFER_MAX_LINES) {
    state.buffer.splice(0, state.buffer.length - CLI_JOB_BUFFER_MAX_LINES)
  }
  const event: CliChunkEvent = { jobId: state.jobId, chunk }
  notifySubscribers(state, 'cli-job:chunk', event)
}

function emitStatus(state: JobState): void {
  const event: CliStatusEvent = {
    jobId: state.jobId,
    status: state.status,
    exitCode: state.exitCode,
    stalled: state.stalled,
  }
  notifySubscribers(state, 'cli-job:status', event)
}

function notifySubscribers(state: JobState, channel: string, event: CliChunkEvent | CliStatusEvent): void {
  for (const wc of state.subscribers) {
    if (wc.isDestroyed()) { removeSubscriber(state, wc); continue }
    try {
      wc.send(channel, event)
    } catch (error) {
      // A lost renderer must not interrupt output capture or child settlement.
      removeSubscriber(state, wc)
      log('warn', 'CLI subscriber unavailable', { jobId: state.jobId, channel, error: serializeError(error) })
    }
  }
}

function isTerminalStatus(status: CliJobStatus): boolean {
  return status === 'exited' || status === 'killed' || status === 'timed-out'
}

function clearRetentionTimer(state: JobState): void {
  if (!state.retentionTimer) return
  clearTimeout(state.retentionTimer)
  state.retentionTimer = null
}

function scheduleRetentionTimer(state: JobState, delayMs: number): void {
  clearRetentionTimer(state)
  state.retentionTimer = setTimeout(() => {
    for (const [wc, onDestroyed] of state.subscriberDestroyed) wc.off('destroyed', onDestroyed)
    state.subscriberDestroyed.clear()
    state.subscribers.clear()
    jobs.delete(state.jobId)
    state.retentionTimer = null
  }, delayMs)
}

function removeSubscriber(state: JobState, wc: WebContents): void {
  const onDestroyed = state.subscriberDestroyed.get(wc)
  if (onDestroyed) {
    wc.off('destroyed', onDestroyed)
    state.subscriberDestroyed.delete(wc)
  }
  state.subscribers.delete(wc)
  if (state.subscribers.size === 0 && isTerminalStatus(state.status)) {
    scheduleRetentionTimer(state, CLI_JOB_RETENTION_WITHOUT_SUBSCRIBERS_MS)
  }
}

function finalize(
  state: JobState,
  status: 'exited' | 'killed' | 'timed-out',
  code: number | null,
  signal: string | null = null,
  error?: unknown,
): void {
  if (state.finalized) return
  state.finalized = true
  if (state.deadlineTimer) clearTimeout(state.deadlineTimer)
  state.deadlineTimer = null

  state.status = status
  state.exitCode = code
  state.stalled = false
  state.child = null

  if (state.stallTimer) {
    clearInterval(state.stallTimer)
    state.stallTimer = null
  }
  if (state.killGraceTimer) {
    clearTimeout(state.killGraceTimer)
    state.killGraceTimer = null
  }

  if (state.stdoutFragment) {
    pushChunk(state, 'stdout', stripAnsi(state.stdoutFragment))
    state.stdoutFragment = ''
  }
  if (state.stderrFragment) {
    pushChunk(state, 'stderr', stripAnsi(state.stderrFragment))
    state.stderrFragment = ''
  }

  emitStatus(state)
  log('info', 'CLI job finished', { jobId: state.jobId, status, exitCode: code })
  state.record.finish({
    startedAt: state.processStartedAt,
    status,
    exitCode: code,
    signal,
    error,
  })

  if (state.subscribers.size === 0) {
    scheduleRetentionTimer(state, CLI_JOB_RETENTION_WITHOUT_SUBSCRIBERS_MS)
  } else {
    scheduleRetentionTimer(state, CLI_JOB_RETENTION_AFTER_EXIT_MS)
  }

  drainPendingJobs()

  state.resolveSettled()
}

function snapshot(state: JobState): CliJobSnapshot {
  return {
    jobId: state.jobId,
    kind: state.kind,
    target: state.target,
    startedAtMs: state.startedAtMs,
    status: state.status,
    exitCode: state.exitCode,
    stalled: state.stalled,
    chunks: state.buffer.slice(),
  }
}

function removePendingJob(jobId: string): void {
  const index = pendingJobIds.indexOf(jobId)
  if (index >= 0) pendingJobIds.splice(index, 1)
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}
