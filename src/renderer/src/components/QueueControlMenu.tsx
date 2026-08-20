import { useCallback, useEffect, useState } from 'react'
import { Menu, MenuItem } from './Menu'
import { useConfirm } from '../context/ConfirmContext'
import type { QueueControlState } from '../../../shared/types'

// The queue's control surface: one small button beside the app menu, opening the
// four actions that were previously impossible or only reachable by quitting the
// app. Deliberately a menu rather than a row of buttons — every item here is
// rare, and rare destructive actions should cost a deliberate second click
// rather than sit permanently under the cursor.
//
// Pause is first because it is the common case: stop starting new work, let the
// image already generating finish and save. Stopping mid-generation throws away
// a partly-done image (and, on a paid backend, a call already billed), so it is
// the second choice, not the default.
export function QueueControlMenu(): React.JSX.Element {
  const confirm = useConfirm()
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
      message: generating === 1
        ? 'Stop the image currently generating? Its work so far is discarded, and it becomes retryable.'
        : `Stop the ${generating} images currently generating? Their work so far is discarded, and they become retryable.`,
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
      title: 'Clear Pending',
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
    <Menu
      label="Queue controls"
      trigger={(props) => (
        <button
          className={`queue-control-btn${paused ? ' paused' : ''}`}
          aria-label="Queue controls"
          title={paused ? 'Queue paused' : 'Queue controls'}
          {...props}
        >
          {/* Drawn, not typed: pause bars when running (the action available),
              a play triangle when paused (what resuming would do). */}
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {paused ? <path d="M8 5v14l11-7z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
          </svg>
        </button>
      )}
    >
      <MenuItem onSelect={() => void handlePause()}>
        {paused ? 'Resume queue' : 'Pause queue'}
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
      <MenuItem onSelect={() => void handleClearPending()} disabled={queued === 0}>
        {queued > 0 ? `Clear pending (${queued})` : 'Clear pending'}
      </MenuItem>
    </Menu>
  )
}
