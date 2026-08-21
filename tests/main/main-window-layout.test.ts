import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeWindowMinHeight, computeWindowMinWidth } from '../../src/shared/layout-metrics'

const keyed = vi.hoisted(() => new Set<string>())
vi.mock('../../src/main/config/api-keys-store', () => ({
  hasApiKey: (id: string) => keyed.has(id),
}))

const { queueManager } = await import('../../src/main/queue/queue-manager')
const {
  getVisiblePaneCount,
  refreshMainWindowMinimumSize,
  registerMainWindowForLayout,
  unregisterMainWindowForLayout,
} = await import('../../src/main/main-window-layout')

let registeredWindow: Parameters<typeof registerMainWindowForLayout>[0] | null = null

beforeEach(() => {
  keyed.clear()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

afterEach(() => {
  if (registeredWindow) unregisterMainWindowForLayout(registeredWindow)
  registeredWindow = null
})

describe('main-window layout registration and refresh', () => {
  it('derives panes from keyed and occupied cloud backends', () => {
    keyed.add('openai.image')
    queueManager.enqueue({ prompt: 'p', backend: 'grok', model: 'm', params: {}, count: 1 } as never)
    expect(getVisiblePaneCount('win32')).toBe(2)
  })

  it('updates the explicitly registered main window', () => {
    keyed.add('openai.image')
    const setMinimumSize = vi.fn()
    registeredWindow = { isDestroyed: () => false, setMinimumSize } as never
    registerMainWindowForLayout(registeredWindow)

    refreshMainWindowMinimumSize()

    expect(setMinimumSize).toHaveBeenCalledWith(
      computeWindowMinWidth(getVisiblePaneCount()),
      computeWindowMinHeight(),
    )
  })

  it('recomputes after the last occupied unkeyed task leaves', () => {
    keyed.add('openai.image')
    const task = queueManager.enqueue({ prompt: 'p', backend: 'grok', model: 'm', params: {}, count: 1 } as never)[0]
    const setMinimumSize = vi.fn()
    registeredWindow = { isDestroyed: () => false, setMinimumSize } as never
    registerMainWindowForLayout(registeredWindow)
    refreshMainWindowMinimumSize()
    const occupiedPaneCount = getVisiblePaneCount()
    expect(setMinimumSize).toHaveBeenLastCalledWith(
      computeWindowMinWidth(occupiedPaneCount),
      computeWindowMinHeight(),
    )

    queueManager.removeTask('grok', task.id)
    refreshMainWindowMinimumSize()
    expect(setMinimumSize).toHaveBeenLastCalledWith(
      computeWindowMinWidth(occupiedPaneCount - 1),
      computeWindowMinHeight(),
    )
  })
})
