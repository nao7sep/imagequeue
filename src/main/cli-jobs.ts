import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import type { WebContents } from 'electron'
import { nanoid } from 'nanoid'
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

interface JobState {
  jobId: string
  kind: CliJobKind
  target: string
  startedAtMs: number
  child: ChildProcessWithoutNullStreams
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
  // True when the last pushed entry for that stream was CR-terminated.
  // Used to coalesce consecutive progress-bar overwrite lines.
  stdoutLastCR: boolean
  stderrLastCR: boolean
}

const jobs = new Map<string, JobState>()

// Public API ---------------------------------------------------------------

export function startCliJob(opts: {
  kind: CliJobKind
  cliPath: string
  args: string[]
  target: string
  logContext: Record<string, unknown>
  onExit?: (exitCode: number | null) => void
}): string {
  const jobId = nanoid()

  // draw-things-cli download explicitly flushes stdout after each \r progress
  // update, so it works fine over a plain pipe.  draw-things-cli import uses
  // regular println()-style output; without a real TTY, the Swift/C runtime
  // uses fully-buffered stdio and all output arrives only when the process
  // exits.  Wrapping with /usr/bin/script creates a PTY that forces
  // line-buffered output so progress lines stream in real time.
  const [spawnCmd, spawnArgs] = opts.kind === 'import'
    ? ['/usr/bin/script', ['-q', '/dev/null', opts.cliPath, ...opts.args]]
    : [opts.cliPath, opts.args]

  const child = spawn(spawnCmd, spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as unknown as ChildProcessWithoutNullStreams

  const state: JobState = {
    jobId,
    kind: opts.kind,
    target: opts.target,
    startedAtMs: Date.now(),
    child,
    buffer: [],
    nextSeq: 0,
    subscribers: new Set(),
    status: 'running',
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
  }
  jobs.set(jobId, state)

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => onData(state, 'stdout', chunk))
  child.stderr.on('data', (chunk: string) => onData(state, 'stderr', chunk))

  child.on('error', (err) => {
    log('error', 'CLI job spawn error', { jobId, ...opts.logContext, message: err.message })
    pushChunk(state, 'stderr', `[spawn error] ${err.message}`)
    finalize(state, 'exited', null)
  })

  child.on('close', (code) => {
    finalize(state, state.status === 'killed' ? 'killed' : 'exited', code)
    opts.onExit?.(code)
  })

  // Stall watchdog — only for downloads; imports legitimately wait for the
  // CLI lock while a generation is in progress, so silence is not an error.
  if (opts.kind === 'download') {
    state.stallTimer = setInterval(() => {
      if (state.status !== 'running') return
      const idle = Date.now() - state.lastStdoutMs
      const wasStalled = state.stalled
      state.stalled = idle >= CLI_JOB_STALL_THRESHOLD_MS
      if (state.stalled !== wasStalled) emitStatus(state)
    }, 5_000)
  }

  log('info', 'CLI job started', { jobId, kind: opts.kind, target: opts.target, ...opts.logContext })
  return jobId
}

export function subscribeCliJob(jobId: string, wc: WebContents): CliJobSnapshot | null {
  const state = jobs.get(jobId)
  if (!state) return null
  state.subscribers.add(wc)
  // Auto-unsubscribe when the renderer goes away.
  wc.once('destroyed', () => { state.subscribers.delete(wc) })
  return snapshot(state)
}

export function unsubscribeCliJob(jobId: string, wc: WebContents): void {
  jobs.get(jobId)?.subscribers.delete(wc)
}

export function killCliJob(jobId: string): void {
  const state = jobs.get(jobId)
  if (!state || state.status !== 'running') return
  state.status = 'killed'
  emitStatus(state)
  try { state.child.kill('SIGTERM') } catch { /* ignore */ }
  state.killGraceTimer = setTimeout(() => {
    try { state.child.kill('SIGKILL') } catch { /* ignore */ }
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

// Internal -----------------------------------------------------------------

function onData(state: JobState, kind: 'stdout' | 'stderr', chunk: string): void {
  if (kind === 'stdout') state.lastStdoutMs = Date.now()
  const fragmentField = kind === 'stdout' ? 'stdoutFragment' : 'stderrFragment'
  const data = state[fragmentField] + chunk

  // Match complete lines and capture their terminator so we can distinguish
  // bare \r (progress-bar overwrite) from \n / \r\n (new line).
  const re = /([^\r\n]*)(\r\n|\r|\n)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(data)) !== null) {
    pushChunk(state, kind, stripAnsi(m[1]), m[2] === '\r')
    lastIndex = re.lastIndex
  }
  state[fragmentField] = data.slice(lastIndex)
}

function pushChunk(state: JobState, kind: 'stdout' | 'stderr', text: string, isCR = false): void {
  if (text.length === 0 && kind === 'stdout') return
  const lastCRKey = kind === 'stdout' ? 'stdoutLastCR' : 'stderrLastCR'

  // Coalesce: bare \r after a prior \r replaces the last buffer entry for that
  // stream instead of appending a new one (keeps progress bars as one live line).
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

  // Deduplicate the "confirmation newline": download tools typically finish a
  // progress bar with "line\r…line\r\n" — the \r\n version has isCR=false but
  // is identical to the already-coalesced \r entry.  Skip it.
  if (!isCR && state[lastCRKey] && state.buffer.length > 0) {
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

function finalize(state: JobState, status: 'exited' | 'killed', code: number | null): void {
  if (state.status === 'exited' || state.status === 'killed') return
  state.status = status
  state.exitCode = code
  state.stalled = false
  if (state.stallTimer) { clearInterval(state.stallTimer); state.stallTimer = null }
  if (state.killGraceTimer) { clearTimeout(state.killGraceTimer); state.killGraceTimer = null }
  // Flush any remaining fragments as final chunks.
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

  // Keep around for a while so a hidden dialog can replay history if re-opened.
  state.retentionTimer = setTimeout(() => {
    jobs.delete(state.jobId)
  }, CLI_JOB_RETENTION_AFTER_EXIT_MS)

  // If no subscribers at exit, we can drop sooner.
  if (state.subscribers.size === 0) {
    clearTimeout(state.retentionTimer)
    state.retentionTimer = null
    setTimeout(() => jobs.delete(state.jobId), 30_000)
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

// Strip CSI / ANSI color codes from CLI output.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}
