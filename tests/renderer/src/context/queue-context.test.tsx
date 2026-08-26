// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueueProvider, useQueue } from '../../../../src/renderer/src/context/QueueContext'
import type { BackendId, Task } from '../../../../src/shared/types'

afterEach(cleanup)

const emptyTasks = (): Record<BackendId, Task[]> => ({
  openai: [], nanobanana: [], grok: [], flux: [], drawthings: [],
})

function Probe(): React.JSX.Element {
  const { loadState, tasks } = useQueue()
  const count = Object.values(tasks).reduce((total, list) => total + list.length, 0)
  return <div>{loadState}:{count}</div>
}

describe('QueueProvider load state', () => {
  it('moves from loading to ready when the initial snapshot arrives', async () => {
    let resolveInitial!: (tasks: Record<BackendId, Task[]>) => void
    const initial = new Promise<Record<BackendId, Task[]>>((resolve) => { resolveInitial = resolve })
    window.electronAPI = {
      getAllStoredTasks: vi.fn(() => initial),
      onQueueUpdated: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    expect(screen.getByText('loading:0')).toBeTruthy()

    await act(async () => resolveInitial(emptyTasks()))
    expect(screen.getByText('ready:0')).toBeTruthy()
  })

  it('reports failure, then recovers when a live queue update arrives', async () => {
    let onUpdate!: (tasks: Record<BackendId, Task[]>) => void
    window.electronAPI = {
      getAllStoredTasks: vi.fn(async () => { throw new Error('unavailable') }),
      onQueueUpdated: vi.fn((callback) => {
        onUpdate = callback
        return () => undefined
      }),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    expect(await screen.findByText('failed:0')).toBeTruthy()

    act(() => onUpdate(emptyTasks()))
    expect(screen.getByText('ready:0')).toBeTruthy()
  })
})
