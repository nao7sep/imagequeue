// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import type { QueueControlState } from '../../../../src/shared/types'

// Four commands on two orthogonal axes. Pause/Resume is a MODE — the user's
// standing choice that nothing new starts. Stop, Retry, and Clear are ACTS on
// the work, and none of them touches the mode: Stop interrupts everything
// active without pausing, Retry re-queues without unpausing, and Clear removes
// BOTH pending kinds (queued and interrupted). The earlier five-command design
// entangled the axes — a Stop that also paused, a Retry that had to unpause,
// a Clear that took one pending kind and stranded the other — and these tests
// pin the disentanglement.

vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async () => true,
}))

const { QueueControlSubmenu, QueuePausedBadge } = await import(
  '../../../../src/renderer/src/components/QueueControls'
)
const { Menu } = await import('../../../../src/renderer/src/components/Menu')

function stubApi(state: Partial<QueueControlState> = {}) {
  const api = {
    getQueueControlState: vi.fn(
      async (): Promise<QueueControlState> => ({
        paused: false,
        generating: 0,
        queued: 0,
        interrupted: 0,
        ...state,
      }),
    ),
    onQueueControlState: vi.fn(() => () => {}),
    setQueuePaused: vi.fn(async () => {}),
    stopAllQueueWork: vi.fn(async () => ({ cancelled: 0, queued: 0 })),
    resumeInterruptedTasks: vi.fn(async () => 0),
    clearPendingTasks: vi.fn(async () => 0),
  }
  ;(window as unknown as { electronAPI: typeof api }).electronAPI = api
  return api
}

async function renderSubmenu(): Promise<void> {
  render(
    <Menu label="Main menu" trigger={(p) => <button {...p}>open</button>}>
      <QueueControlSubmenu />
    </Menu>,
  )
  await act(async () => {
    screen.getByText('open').click()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
  await act(async () => {
    screen.getByRole('menuitem', { name: /All Queues/ }).click()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
}

afterEach(cleanup)

describe('QueuePausedBadge', () => {
  it('says nothing while the queue is running', async () => {
    stubApi({ paused: false })
    render(<QueuePausedBadge />)
    await waitFor(() => expect(window.electronAPI.getQueueControlState).toHaveBeenCalled())
    expect(screen.queryByText('Paused')).toBeNull()
  })

  it('shows the standing state once the queue is paused', async () => {
    stubApi({ paused: true })
    render(<QueuePausedBadge />)
    await waitFor(() => expect(screen.getByText('Paused')).toBeTruthy())
  })
})

describe('QueueControlSubmenu', () => {
  it('offers exactly four commands, with counts', async () => {
    stubApi({ generating: 2, queued: 5, interrupted: 3 })
    await renderSubmenu()
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toBeTruthy()
    // Stop acts on everything active: generating + queued.
    expect(screen.getByRole('menuitem', { name: 'Stop (7)' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Retry all stopped (3)' })).toBeTruthy()
    // Clear acts on everything pending: queued + interrupted.
    expect(screen.getByRole('menuitem', { name: 'Clear pending (8)' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Stop generating/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Stop everything/ })).toBeNull()
  })

  it('disables what an empty queue cannot do, rather than hiding it', async () => {
    stubApi()
    await renderSubmenu()
    for (const name of ['Stop', 'Retry all stopped', 'Clear pending']) {
      expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true')
    }
    expect(
      screen.getByRole('menuitem', { name: 'Pause' }).getAttribute('aria-disabled'),
    ).toBeNull()
  })

  // Interrupted tasks alone are enough for Clear: this is the exact case the
  // first cut missed, where clearing after a stop removed nothing.
  it('enables Clear when only stopped tasks remain', async () => {
    const api = stubApi({ interrupted: 4 })
    await renderSubmenu()
    const clear = screen.getByRole('menuitem', { name: 'Clear pending (4)' })
    expect(clear.getAttribute('aria-disabled')).toBeNull()
    await act(async () => { clear.click() })
    expect(api.clearPendingTasks).toHaveBeenCalled()
  })

  it('Stop stops the work without touching the pause mode', async () => {
    const api = stubApi({ generating: 2, queued: 3 })
    await renderSubmenu()
    await act(async () => {
      screen.getByRole('menuitem', { name: 'Stop (5)' }).click()
    })
    expect(api.stopAllQueueWork).toHaveBeenCalled()
    expect(api.setQueuePaused).not.toHaveBeenCalled()
  })

  // Retry never unpauses: Stop no longer pauses, so the stop-then-retry flow
  // re-queues into a running processor — and a pause that IS set is the user's
  // own standing choice, which retrying must not silently revoke.
  it('Retry re-queues and leaves an explicit pause standing', async () => {
    const api = stubApi({ paused: true, interrupted: 4 })
    await renderSubmenu()
    await act(async () => {
      screen.getByRole('menuitem', { name: 'Retry all stopped (4)' }).click()
    })
    expect(api.resumeInterruptedTasks).toHaveBeenCalled()
    expect(api.setQueuePaused).not.toHaveBeenCalled()
  })
})
