import { useCallback, useEffect, useState } from 'react'
import { MenuItem, Submenu } from './Menu'
import { useConfirm } from '../context/ConfirmContext'
import type { QueueControlState } from '../../../shared/types'

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
    void window.electronAPI.getQueueControlState().then(setState)
    return window.electronAPI.onQueueControlState(setState)
  }, [])

  // Every action refreshes the state it just changed, so counts in the menu
  // never lag the queue.
  const refresh = useCallback(async (): Promise<void> => {
    setState(await window.electronAPI.getQueueControlState())
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

  const handlePause = useCallback(async (): Promise<void> => {
    await window.electronAPI.setQueuePaused(!paused)
    await refresh()
  }, [paused, refresh])

  const handleStopGenerating = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Stop Generating',
      // Aborting a cloud request stops us waiting; it does not stop the
      // provider, which bills the call either way. Said here rather than
      // discovered on an invoice.
      message: generating === 1
        ? 'Stop the image currently generating? Its work so far is discarded and it becomes retryable, but a paid backend may still bill the call.'
        : `Stop the ${generating} images currently generating? Their work so far is discarded and they become retryable, but a paid backend may still bill the calls.`,
      confirmLabel: 'Stop',
      danger: true,
    })
    if (!ok) return
    await window.electronAPI.stopGenerating()
    await refresh()
  }, [confirm, generating, refresh])

  const handleStopAll = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Stop Everything',
      message: `Stop ${generating} generating and hold ${queued} waiting task${queued === 1 ? '' : 's'}? ` +
        'The queue pauses, and every stopped task becomes retryable.',
      confirmLabel: 'Stop All',
      danger: true,
    })
    if (!ok) return
    await window.electronAPI.stopAllQueueWork()
    await refresh()
  }, [confirm, generating, queued, refresh])

  const handleRetryAll = useCallback(async (): Promise<void> => {
    await window.electronAPI.resumeInterruptedTasks()
    // Retrying while paused would queue work that never starts.
    if (paused) await window.electronAPI.setQueuePaused(false)
    await refresh()
  }, [paused, refresh])

  const handleClearPending = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Clear Queued',
      message: `Remove ${queued} task${queued === 1 ? '' : 's'} waiting to start? ` +
        'Unlike stopping, these are not retryable — they are removed. Generating and finished tasks are untouched.',
      confirmLabel: 'Clear',
      danger: true,
    })
    if (!ok) return
    await window.electronAPI.clearPendingTasks()
    await refresh()
  }, [confirm, queued, refresh])

  return (
    // The label carries the scope, so the items need not repeat it: none of
    // these acts on one column. Pause is a single global flag, and the other
    // four iterate every backend's queue.
    <Submenu label="All Queues">
      <MenuItem onSelect={() => void handlePause()}>
        {paused ? 'Resume' : 'Pause'}
      </MenuItem>
      <MenuItem onSelect={() => void handleStopGenerating()} disabled={generating === 0}>
        {generating > 0 ? `Stop generating (${generating})` : 'Stop generating'}
      </MenuItem>
      <MenuItem onSelect={() => void handleStopAll()} disabled={generating === 0 && queued === 0}>
        Stop everything
      </MenuItem>
      <MenuItem onSelect={() => void handleRetryAll()} disabled={interrupted === 0}>
        {interrupted > 0 ? `Retry all stopped (${interrupted})` : 'Retry all stopped'}
      </MenuItem>
      {/* "Queued" is the status's own name and the word the columns already use
          ("No tasks queued"); "pending" would be a second word for one state. */}
      <MenuItem onSelect={() => void handleClearPending()} disabled={queued === 0}>
        {queued > 0 ? `Clear queued (${queued})` : 'Clear queued'}
      </MenuItem>
    </Submenu>
  )
}
