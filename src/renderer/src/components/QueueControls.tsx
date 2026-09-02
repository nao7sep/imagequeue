import { useCallback, useEffect, useState } from 'react'
import { MenuItem, Submenu } from './Menu'
import { useConfirm } from '../context/ConfirmContext'
import type { QueueControlState } from '../../../shared/types'
import { reportOperationalFailure } from '../utils/operationalFailure'

const QUEUE_CONTROL_FAILURE = 'The queue command could not be completed. The current queue is unchanged; try again.'

// The queue's control surface: a submenu in the app menu, plus the one piece of
// it that has to be visible without opening anything.
//
// Everything here is rare — pausing, stopping, clearing — so none of it earns
// permanent space in a window that is already dense with per-backend controls,
// and a rare destructive action should cost a deliberate second click rather
// than sit under the cursor.
//
// Pause is first because it is the common case: stop starting new work, let the
// image already generating finish and save. Stopping mid-generation throws away
// a partly-done image (and, on a paid backend, a call already billed), so it is
// the second choice, not the default.

function useQueueControlState(): { state: QueueControlState | null; refresh: () => Promise<void> } {
  const [state, setState] = useState<QueueControlState | null>(null)

  useEffect(() => {
    void window.electronAPI.getQueueControlState().then(setState).catch((error) => {
      reportOperationalFailure('queue-controls', 'Queue controls could not be loaded. Reopen the menu to try again.', 'Failed to load queue control state', error)
    })
    return window.electronAPI.onQueueControlState(setState)
  }, [])

  // Every action refreshes the state it just changed, so counts in the menu
  // never lag the queue.
  const refresh = useCallback(async (): Promise<void> => {
    try { setState(await window.electronAPI.getQueueControlState()) } catch (error) {
      reportOperationalFailure('queue-controls', 'Queue controls could not be refreshed. Reopen the menu to try again.', 'Failed to refresh queue control state', error)
    }
  }, [])

  return { state, refresh }
}

/**
 * Paused is a standing state, and the only part of this surface that must be
 * readable without opening a menu: a queue that starts nothing looks broken
 * rather than held. Nothing is drawn while the queue runs.
 */
export function QueuePausedBadge(): React.JSX.Element | null {
  const { state } = useQueueControlState()
  if (!state?.paused) return null
  return (
    <span className="queue-paused-badge" title="The queue is paused; nothing new will start">
      Paused
    </span>
  )
}

export function QueueControlSubmenu(): React.JSX.Element {
  const confirm = useConfirm()
  const { state, refresh } = useQueueControlState()

  const paused = state?.paused ?? false
  const generating = state?.generating ?? 0
  const queued = state?.queued ?? 0
  const interrupted = state?.interrupted ?? 0

  const pending = queued + interrupted

  const handlePause = useCallback(async (): Promise<void> => {
    try { await window.electronAPI.setQueuePaused(!paused); await refresh() } catch (error) {
      reportOperationalFailure('queue-controls', QUEUE_CONTROL_FAILURE, 'Failed to change queue pause state', error)
    }
  }, [paused, refresh])

  // Stop is an ACT on the work, orthogonal to Pause (a MODE): it interrupts
  // everything active — cancels what is generating and holds what is queued —
  // without touching the pause flag. The queue goes quiet because nothing is
  // left in `queued`, not because a mode was set; Retry then re-queues the
  // stopped tasks and they start immediately, no Resume required.
  const handleStop = useCallback(async (): Promise<void> => {
    const parts: string[] = []
    if (generating > 0) parts.push(`${generating} generating`)
    if (queued > 0) parts.push(`${queued} waiting`)
    const ok = await confirm({
      title: 'Stop',
      // Aborting a cloud request stops us waiting; it does not stop the
      // provider, which bills the call either way. Said here rather than
      // discovered on an invoice.
      message: `Stop ${parts.join(' and ')} task${generating + queued === 1 ? '' : 's'}? ` +
        'Work in progress is discarded and every stopped task becomes retryable, ' +
        'but a paid backend may still bill calls already in flight.',
      confirmLabel: 'Stop',
      danger: true,
    })
    if (!ok) return
    try { await window.electronAPI.stopAllQueueWork(); await refresh() } catch (error) {
      reportOperationalFailure('queue-controls', QUEUE_CONTROL_FAILURE, 'Failed to stop queue work', error)
    }
  }, [confirm, generating, queued, refresh])

  // No pause manipulation here: Stop never pauses, so the common stop-then-retry
  // flow re-queues into a running processor. A pause that IS set is the user's
  // own standing choice, and retrying must not silently revoke it — the retried
  // tasks simply wait, exactly as the Paused badge says they will.
  const handleRetryAll = useCallback(async (): Promise<void> => {
    try { await window.electronAPI.resumeInterruptedTasks(); await refresh() } catch (error) {
      reportOperationalFailure('queue-controls', QUEUE_CONTROL_FAILURE, 'Failed to retry stopped queue work', error)
    }
  }, [refresh])

  const handleClearPending = useCallback(async (): Promise<void> => {
    const parts: string[] = []
    if (queued > 0) parts.push(`${queued} waiting`)
    if (interrupted > 0) parts.push(`${interrupted} stopped`)
    const ok = await confirm({
      title: 'Clear Pending',
      message: `Remove ${parts.join(' and ')} task${pending === 1 ? '' : 's'}? ` +
        'Unlike stopping, these are not retryable — they are removed. Generating and finished tasks are untouched.',
      confirmLabel: 'Clear',
      danger: true,
    })
    if (!ok) return
    try { await window.electronAPI.clearPendingTasks(); await refresh() } catch (error) {
      reportOperationalFailure('queue-controls', QUEUE_CONTROL_FAILURE, 'Failed to clear pending queue work', error)
    }
  }, [confirm, queued, interrupted, pending, refresh])

  return (
    // The label carries the scope, so the items need not repeat it: none of
    // these acts on one column. Pause is a single global flag, and the other
    // three iterate every backend's queue. Four commands on two orthogonal
    // axes — Pause/Resume the mode, Stop/Retry/Clear the acts — replacing the
    // five that entangled them (a Stop that also paused, a Retry that had to
    // unpause, a Clear that took one pending kind and stranded the other).
    <Submenu label="All Queues">
      <MenuItem onSelect={() => void handlePause()}>
        {paused ? 'Resume' : 'Pause'}
      </MenuItem>
      <MenuItem onSelect={() => void handleStop()} disabled={generating === 0 && queued === 0}>
        {generating + queued > 0 ? `Stop (${generating + queued})` : 'Stop'}
      </MenuItem>
      <MenuItem onSelect={() => void handleRetryAll()} disabled={interrupted === 0}>
        {interrupted > 0 ? `Retry all stopped (${interrupted})` : 'Retry all stopped'}
      </MenuItem>
      {/* Pending = queued + interrupted: everything that would still produce an
          image. Clearing must take both — removing one kind and stranding the
          other made the command a partial no-op. */}
      <MenuItem onSelect={() => void handleClearPending()} disabled={pending === 0}>
        {pending > 0 ? `Clear pending (${pending})` : 'Clear pending'}
      </MenuItem>
    </Submenu>
  )
}
