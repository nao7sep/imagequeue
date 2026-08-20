// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import type { QueueControlState } from '../../../../src/shared/types'

// The queue's controls live in the app menu, so the only part of them that
// stays in the window is the paused badge — which makes "is it visible when
// paused, and absent when not" the property worth pinning. The commands
// themselves are pinned for their labels, their disabled states, and the one
// piece of behaviour that is not obvious: retrying has to lift a pause, or the
// retried work is queued and never starts.

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
    stopGenerating: vi.fn(async () => {}),
    stopAllQueueWork: vi.fn(async () => {}),
    resumeInterruptedTasks: vi.fn(async () => {}),
    clearPendingTasks: vi.fn(async () => {}),
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
    screen.getByRole('menuitem', { name: /Queue/ }).click()
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
  it('carries every command, with counts, behind one submenu', async () => {
    stubApi({ generating: 2, queued: 5, interrupted: 3 })
    await renderSubmenu()
    expect(screen.getByRole('menuitem', { name: 'Pause queue' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Stop generating (2)' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Stop everything' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Retry all stopped (3)' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Clear pending (5)' })).toBeTruthy()
  })

  it('disables what an empty queue cannot do, rather than hiding it', async () => {
    stubApi()
    await renderSubmenu()
    for (const name of ['Stop generating', 'Stop everything', 'Retry all stopped', 'Clear pending']) {
      expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true')
    }
    expect(
      screen.getByRole('menuitem', { name: 'Pause queue' }).getAttribute('aria-disabled'),
    ).toBeNull()
  })

  it('lifts a pause when retrying, so the retried work actually starts', async () => {
    const api = stubApi({ paused: true, interrupted: 4 })
    await renderSubmenu()
    await act(async () => {
      screen.getByRole('menuitem', { name: 'Retry all stopped (4)' }).click()
    })
    expect(api.resumeInterruptedTasks).toHaveBeenCalled()
    expect(api.setQueuePaused).toHaveBeenCalledWith(false)
  })

  it('leaves a running queue alone when retrying', async () => {
    const api = stubApi({ paused: false, interrupted: 4 })
    await renderSubmenu()
    await act(async () => {
      screen.getByRole('menuitem', { name: 'Retry all stopped (4)' }).click()
    })
    expect(api.resumeInterruptedTasks).toHaveBeenCalled()
    expect(api.setQueuePaused).not.toHaveBeenCalled()
  })
})
