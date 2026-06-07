import { spawn } from 'child_process'
import type { WebContents } from 'electron'
import { nanoid } from 'nanoid'
import { spawn as spawnPty } from 'node-pty'
import { log } from './logger'
import {
  CliChunk,
  CliChunkEvent,
  CliJobKind,
  CliJobSnapshot,
  CliJobStatus,
  CliStatusEvent,
  CLI_JOB_BUFFER_MAX_LINES,
  CLI_JOB_KILL_GRACE_MS,
  CLI_JOB_RETENTION_AFTER_EXIT_MS,
  CLI_JOB_STALL_THRESHOLD_MS,
} from '../shared/cli-jobs'

interface StartCliJobOpts {
  kind: CliJobKind
  cliPath: string
  args: string[]
  target: string
  logContext: Record<string, unknown>
}

interface JobState {
  jobId: string
  kind: CliJobKind
  target: string
  startedAtMs: number
  child: { kill(signal?: string): void } | null
  buffer: CliChunk[]
  nextSeq: number
  subscribers: Set<WebContents>
  status: CliJobStatus
  exitCode: number | null
  stalled: boolean
  lastStdoutMs: number
  stallTimer: NodeJS.Timeout | null
  killGraceTimer: NodeJS.Timeout | null
  retentionTimer: NodeJS.Timeout | null
  stdoutFragment: string
  stderrFragment: string
  stdoutLastCR: boolean
  stderrLastCR: boolean
  finalized: boolean
  cliPath: string
  args: string[]
  logContext: Record<string, unknown>
}

const jobs = new Map<string, JobState>()
const queuedImportJobIds: string[] = []
let activeImportJobId: string | null = null
const CLI_JOB_RETENTION_WITHOUT_SUBSCRIBERS_MS = 30_000

export function startCliJob(opts: StartCliJobOpts): string {
  const jobId = nanoid()
  const state: JobState = {
    jobId,
    kind: opts.kind,
    target: opts.target,
    startedAtMs: Date.now(),
    child: null,
    buffer: [],
    nextSeq: 0,
    subscribers: new Set(),
    status: opts.kind === 'import' ? 'queued' : 'running',
    exitCode: null,
    stalled: false,
    lastStdoutMs: Date.now(),
    stallTimer: null,
    killGraceTimer: null,
    retentionTimer: null,
    stdoutFragment: '',
    stderrFragment: '',
    stdoutLastCR: false,
    stderrLastCR: false,
    finalized: false,
    cliPath: opts.cliPath,
    args: opts.args,
    logContext: opts.logContext,
  }
  jobs.set(jobId, state)

  if (opts.kind === 'import') {
    queuedImportJobIds.push(jobId)
    log('info', 'CLI import job queued', { jobId, target: opts.target, ...opts.logContext })
    launchNextImport()
  } else {
    launchJob(state)
  }

  return jobId
}

export function subscribeCliJob(jobId: string, wc: WebContents): CliJobSnapshot | null {
  const state = jobs.get(jobId)
  if (!state) return null
  state.subscribers.add(wc)
  clearRetentionTimer(state)
  wc.once('destroyed', () => { removeSubscriber(state, wc) })
  return snapshot(state)
}

export function unsubscribeCliJob(jobId: string, wc: WebContents): void {
  const state = jobs.get(jobId)
  if (!state) return
  removeSubscriber(state, wc)
}

export function killCliJob(jobId: string): void {
  const state = jobs.get(jobId)
  if (!state) return

  if (state.status === 'queued') {
    removeQueuedImport(jobId)
    state.status = 'killed'
    emitStatus(state)
    finalize(state, 'killed', null)
    log('info', 'Queued CLI job removed', { jobId })
    return
  }

  if (state.status !== 'running' && state.status !== 'stalled') return
  state.status = 'killed'
  state.stalled = false
  emitStatus(state)
  try { state.child?.kill('SIGTERM') } catch { /* ignore */ }
  state.killGraceTimer = setTimeout(() => {
    try { state.child?.kill('SIGKILL') } catch { /* ignore */ }
  }, CLI_JOB_KILL_GRACE_MS)
  log('info', 'CLI job kill requested', { jobId })
}

export function killAllCliJobs(): void {
  for (const jobId of jobs.keys()) killCliJob(jobId)
}

export function getCliJobSnapshot(jobId: string): CliJobSnapshot | null {
  const state = jobs.get(jobId)
  return state ? snapshot(state) : null
}

function launchNextImport(): void {
  if (activeImportJobId !== null) return

  while (queuedImportJobIds.length > 0) {
    const nextJobId = queuedImportJobIds.shift()!
    const state = jobs.get(nextJobId)
    if (!state || state.status !== 'queued') continue
    activeImportJobId = nextJobId
    launchJob(state)
    return
  }
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
  if (state.kind === 'import') {
    launchImportJob(state)
    return
  }

  launchPipeJob(state)
}

function launchPipeJob(state: JobState): void {
  const child = spawn(state.cliPath, state.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // stdio fds 1 and 2 are 'pipe', so Node creates these streams; the guard
  // narrows the `Readable | null` the spawn() return type reports for an
  // explicit stdio tuple, and routes the impossible miss through the same
  // failure path as a spawn error rather than throwing uncaught.
  const { stdout, stderr } = child
  if (!stdout || !stderr) {
    log('error', 'CLI job spawned without stdout/stderr pipes', { jobId: state.jobId, ...state.logContext })
    pushChunk(state, 'stderr', '[spawn error] missing output stream')
    finalize(state, 'exited', null)
    return
  }

  state.child = {
    kill: (signal?: string) => {
      child.kill(signal as NodeJS.Signals | undefined)
    },
  }
  state.lastStdoutMs = Date.now()
  state.status = 'running'
  state.stalled = false

  stdout.setEncoding('utf8')
  stderr.setEncoding('utf8')
  stdout.on('data', (chunk: string) => onData(state, 'stdout', chunk))
  stderr.on('data', (chunk: string) => onData(state, 'stderr', chunk))

  child.on('error', (err) => {
    log('error', 'CLI job spawn error', { jobId: state.jobId, ...state.logContext, message: err.message })
    pushChunk(state, 'stderr', `[spawn error] ${err.message}`)
    finalize(state, state.status === 'killed' ? 'killed' : 'exited', null)
  })

  child.on('close', (code) => {
    finalize(state, state.status === 'killed' ? 'killed' : 'exited', code)
  })

  if (state.kind === 'download') {
    state.stallTimer = setInterval(() => {
      if (state.status !== 'running' && state.status !== 'stalled') return
      const idle = Date.now() - state.lastStdoutMs
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
    state.lastStdoutMs = Date.now()
    state.status = 'running'
    state.stalled = false

    dataSubscription = ptyProcess.onData((chunk) => {
      onData(state, 'stdout', chunk)
    })
    exitSubscription = ptyProcess.onExit(({ exitCode }) => {
      dataSubscription?.dispose()
      exitSubscription?.dispose()
      finalize(state, state.status === 'killed' ? 'killed' : 'exited', exitCode)
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
    const message = err instanceof Error ? err.message : String(err)
    log('error', 'CLI PTY spawn error', { jobId: state.jobId, ...state.logContext, message })
    pushChunk(state, 'stderr', `[spawn error] ${message}`)
    finalize(state, state.status === 'killed' ? 'killed' : 'exited', null)
  }
}

function onData(state: JobState, kind: 'stdout' | 'stderr', chunk: string): void {
  if (kind === 'stdout') {
    state.lastStdoutMs = Date.now()
    if (state.status === 'stalled') {
      state.status = 'running'
      state.stalled = false
      emitStatus(state)
    }
  }

  const fragmentField = kind === 'stdout' ? 'stdoutFragment' : 'stderrFragment'
  const data = state[fragmentField] + chunk
  const re = /([^\r\n]*)(\r\n|\r|\n)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(data)) !== null) {
    pushChunk(state, kind, stripAnsi(match[1]), match[2] === '\r')
    lastIndex = re.lastIndex
  }

  state[fragmentField] = data.slice(lastIndex)
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
      for (const wc of state.subscribers) {
        if (!wc.isDestroyed()) wc.send('cli-job:chunk', event)
      }
      return
    }
  }

  if (!isCR && state[lastCRKey] && state.buffer.length > 0) {
    const last = state.buffer[state.buffer.length - 1]
    if (last.kind === kind && last.text === text) {
      state[lastCRKey] = false
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
  for (const wc of state.subscribers) {
    if (!wc.isDestroyed()) wc.send('cli-job:chunk', event)
  }
}

function emitStatus(state: JobState): void {
  const event: CliStatusEvent = {
    jobId: state.jobId,
    status: state.status,
    exitCode: state.exitCode,
    stalled: state.stalled,
  }
  for (const wc of state.subscribers) {
    if (!wc.isDestroyed()) wc.send('cli-job:status', event)
  }
}

function isTerminalStatus(status: CliJobStatus): boolean {
  return status === 'exited' || status === 'killed'
}

function clearRetentionTimer(state: JobState): void {
  if (!state.retentionTimer) return
  clearTimeout(state.retentionTimer)
  state.retentionTimer = null
}

function scheduleRetentionTimer(state: JobState, delayMs: number): void {
  clearRetentionTimer(state)
  state.retentionTimer = setTimeout(() => {
    jobs.delete(state.jobId)
    state.retentionTimer = null
  }, delayMs)
}

function removeSubscriber(state: JobState, wc: WebContents): void {
  state.subscribers.delete(wc)
  if (state.subscribers.size === 0 && isTerminalStatus(state.status)) {
    scheduleRetentionTimer(state, CLI_JOB_RETENTION_WITHOUT_SUBSCRIBERS_MS)
  }
}

function finalize(state: JobState, status: 'exited' | 'killed', code: number | null): void {
  if (state.finalized) return
  state.finalized = true

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
  log('info', `CLI job ${status}`, { jobId: state.jobId, exitCode: code })

  if (state.subscribers.size === 0) {
    scheduleRetentionTimer(state, CLI_JOB_RETENTION_WITHOUT_SUBSCRIBERS_MS)
  } else {
    scheduleRetentionTimer(state, CLI_JOB_RETENTION_AFTER_EXIT_MS)
  }

  if (state.kind === 'import' && activeImportJobId === state.jobId) {
    activeImportJobId = null
    launchNextImport()
  }
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

function removeQueuedImport(jobId: string): void {
  const index = queuedImportJobIds.indexOf(jobId)
  if (index >= 0) queuedImportJobIds.splice(index, 1)
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}
