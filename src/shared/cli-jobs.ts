// Types shared between main and renderer for the in-app CLI job dialog.

export type CliJobKind = 'import' | 'download'
export type CliJobStatus = 'queued' | 'running' | 'stalled' | 'exited' | 'killed'
export type CliChunkKind = 'stdout' | 'stderr'

// One line of output. Stored in the ring buffer in main, replayed to subscribers,
// and emitted live via 'cli-job:chunk' events.
export interface CliChunk {
  seq: number        // monotonic per-job, used to dedupe replay vs live
  kind: CliChunkKind
  text: string       // a single logical line, ANSI escapes already stripped
  tsMs: number
}

export interface CliJobSnapshot {
  jobId: string
  kind: CliJobKind
  // Human-friendly target — the basename of the artifact (import) or the model
  // filename (download). Shown in the dialog header.
  target: string
  startedAtMs: number
  status: CliJobStatus
  exitCode: number | null   // populated once status is 'exited' or 'killed'
  stalled: boolean          // true while no stdout chunk for >= STALL_THRESHOLD_MS
  chunks: CliChunk[]        // full ring buffer at snapshot time
}

// Sent on 'cli-job:chunk'.
// When replace is true, the chunk's seq matches an already-sent entry and the
// renderer should update it in place rather than appending (CR-coalescing).
export interface CliChunkEvent {
  jobId: string
  chunk: CliChunk
  replace?: boolean
}

// Sent on 'cli-job:status'. Covers queueing, stalled/unstalled transitions,
// and final exit.
export interface CliStatusEvent {
  jobId: string
  status: CliJobStatus
  exitCode: number | null
  stalled: boolean
}

export const CLI_JOB_STALL_THRESHOLD_MS = 60_000
export const CLI_JOB_BUFFER_MAX_LINES = 2_000
export const CLI_JOB_KILL_GRACE_MS = 3_000
export const CLI_JOB_RETENTION_AFTER_EXIT_MS = 10 * 60 * 1_000
