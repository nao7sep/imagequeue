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
    const timer = setTimeout(() => finish(resolve), Math.max(0, ms))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
