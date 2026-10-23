/** Wait for `ms`, or reject immediately when `signal` aborts. The listener and
 * timer are always released together so a cancelled wait leaves no later work. */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  const aborted = (): DOMException => new DOMException('The operation was aborted.', 'AbortError')
  if (signal.aborted) return Promise.reject(aborted())

  return new Promise((resolve, reject) => {
    const finish = (fn: () => void): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = (): void => finish(() => reject(aborted()))
    // Node clamps overflowing timers to 1 ms; split long server-requested
    // waits so they cannot cause an early retry.
    let remaining = Math.max(0, ms)
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      const chunk = Math.min(remaining, 2_147_483_647)
      timer = setTimeout(() => {
        remaining -= chunk
        if (remaining > 0) schedule()
        else finish(resolve)
      }, chunk)
    }
    schedule()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
