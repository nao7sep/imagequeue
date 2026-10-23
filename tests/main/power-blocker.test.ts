import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  keepAwake: true,
  generating: false,
  cli: false,
  brainstorm: false,
  assertions: new Set<number>(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: h.start,
    stop: h.stop,
    isStarted: (id: number) => h.assertions.has(id),
  },
}))
vi.mock('../../src/main/config', () => ({ loadConfig: () => ({ general: { keep_awake_during_work: h.keepAwake } }) }))
vi.mock('../../src/main/queue/queue-manager', () => ({ queueManager: { hasGeneratingTasks: () => h.generating } }))
vi.mock('../../src/main/cli-jobs', () => ({ hasRunningCliJobs: () => h.cli }))
vi.mock('../../src/main/brainstorm', () => ({ hasActiveBrainstorms: () => h.brainstorm }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn() }))

let power: typeof import('../../src/main/power-blocker')
let operations: typeof import('../../src/main/dependencies/operations')
const held: Array<{ settle: () => void; promise: Promise<void> }> = []

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.keepAwake = true
  h.generating = h.cli = h.brainstorm = false
  h.assertions.clear()
  h.start.mockImplementation(() => { h.assertions.add(1); return 1 })
  h.stop.mockImplementation((id: number) => h.assertions.delete(id))
  // Both the monitor and the real operation owner get a fresh instance per
  // case, including the quit state consulted when admitting an operation.
  const { setQuitting } = await import('../../src/main/quit-state')
  setQuitting(false)
  operations = await import('../../src/main/dependencies/operations')
  power = await import('../../src/main/power-blocker')
})

afterEach(async () => {
  for (const operation of held) operation.settle()
  await Promise.all(held.map((operation) => operation.promise))
  held.length = 0
  power.releaseWakeLock()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function holdDependency() {
  const owner = {}
  let settle!: () => void
  let signal!: AbortSignal
  const physicalWork = new Promise<void>((resolve) => { settle = resolve })
  const promise = operations.runDependencyOperation(owner, ['cli'], (operationSignal) => {
    signal = operationSignal
    return physicalWork
  })
  held.push({ settle, promise })
  return { owner, settle, promise, signal }
}

describe('wake lock monitor', () => {
  it('keeps cancelled dependency work protected until physical settlement', async () => {
    const operation = holdDependency()
    power.startWakeLockMonitor()
    power.startWakeLockMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.start).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
    expect(vi.getTimerCount()).toBe(1)

    operations.cancelDependencyOperation(operation.owner, 'cli', new Error('Cancelled'))
    expect(operation.signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.assertions.size).toBe(1)
    expect(h.start).toHaveBeenCalledOnce()
    expect(h.stop).not.toHaveBeenCalled()

    operation.settle()
    await operation.promise
    expect(h.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.stop).toHaveBeenCalledExactlyOnceWith(1)
    expect(h.assertions.size).toBe(0)
  })

  it('releases on the next poll when opted out while dependency work persists', async () => {
    holdDependency()
    power.startWakeLockMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.assertions.size).toBe(1)

    h.keepAwake = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.stop).toHaveBeenCalledExactlyOnceWith(1)
    expect(operations.hasActiveDependencyOperations()).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.assertions.size).toBe(0)
    expect(h.start).toHaveBeenCalledOnce()
  })

  it('releases completed dependency work on the next poll', async () => {
    const operation = holdDependency()
    power.startWakeLockMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.assertions.size).toBe(1)

    operation.settle()
    await operation.promise
    expect(h.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(999)
    expect(h.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.stop).toHaveBeenCalledExactlyOnceWith(1)
  })

  it.each(['generating', 'cli', 'brainstorm'] as const)('continues protecting %s work', async (source) => {
    h[source] = true
    power.startWakeLockMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.start).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension')
    h[source] = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.stop).toHaveBeenCalledExactlyOnceWith(1)
  })
})
