import { powerSaveBlocker } from 'electron'
import { queueManager } from './queue/queue-manager'
import { hasRunningCliJobs } from './cli-jobs'
import { hasActiveBrainstorms } from './brainstorm'
import { loadConfig } from './config'
import { log } from './logger'

// Cross-platform "caffeinate": holds a single OS power assertion while the app
// has long-running work in flight, so the machine doesn't sleep mid-generation,
// mid-download, or mid-elaboration. Electron's powerSaveBlocker wraps the native
// mechanism on each platform (IOKit assertions on macOS, SetThreadExecutionState on Windows,
// a freedesktop D-Bus inhibit on Linux), and the OS releases the assertion
// automatically if this process exits — so there's nothing to clean up on crash.
//
// We use 'prevent-app-suspension', not 'prevent-display-sleep': the goal is to
// keep work running, not to keep the screen lit. Note that on macOS this still
// cannot defeat clamshell sleep (lid closed on battery with no external power or
// display), and on Linux it is only honored by desktop environments that
// implement the inhibit interface.
//
// The General → "Keep system awake during work" setting (on by default) gates
// this. It's read on every poll, so toggling it off releases the assertion
// within a second without a restart.

let blockerId: number | null = null
let monitor: NodeJS.Timeout | null = null

// The three kinds of work worth keeping the machine awake for: an image task
// generating, a Draw Things CLI download/import running, or a prompt
// elaboration in flight. Elaboration matters because it runs before any task is
// queued, so it is the one long operation neither task nor CLI status reflects.
function isBusy(): boolean {
  return queueManager.hasGeneratingTasks() || hasRunningCliJobs() || hasActiveBrainstorms()
}

// The assertion is held only when the user has opted in (the default) AND there
// is work to protect.
function shouldStayAwake(): boolean {
  return loadConfig().general.keep_awake_during_work && isBusy()
}

// Idempotent: keeps at most one assertion alive. Starting twice would leak the
// first id, so we early-return when the desired state already holds.
function setWakeLock(active: boolean): void {
  if (active) {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
    log('info', 'Wake lock acquired', { blockerId })
  } else {
    if (blockerId === null) return
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    log('info', 'Wake lock released', { blockerId })
    blockerId = null
  }
}

// Polls and keeps the assertion in sync. A 1s poll is far finer than any OS
// sleep timer (minutes), so work is always covered. The processor and CLI jobs
// run on their own clocks; polling avoids wiring a wake lock call into every
// status transition across both subsystems, and also picks up the setting toggle.
export function startWakeLockMonitor(): void {
  if (monitor) return
  monitor = setInterval(() => setWakeLock(shouldStayAwake()), 1000)
}

export function releaseWakeLock(): void {
  setWakeLock(false)
}
