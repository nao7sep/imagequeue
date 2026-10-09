/** A single coalescing owner. Failed writes remain pending for a quit Retry;
 * drain rejects, while timer failures are reported without an unhandled error. */
export interface CoalescedWriter {
  schedule(): void
  cancel(): void
  drain(): Promise<void>
}
export interface CoalescedWriterOptions {
  flush: () => void | Promise<void>
  debounceMs: number
  onError?: (error: unknown) => void
  onDrain?: () => void
}
export function createCoalescedWriter(options: CoalescedWriterOptions): CoalescedWriter {
  let timer: ReturnType<typeof setTimeout> | null = null
  let revision = 0
  let saved = 0
  let running: Promise<void> | null = null
  const clear = (): void => { if (timer !== null) clearTimeout(timer); timer = null }
  const drain = (): Promise<void> => {
    clear()
    if (running) return running
    const operation = Promise.resolve().then(async () => {
      while (saved < revision) {
        const writing = revision
        await options.flush()
        saved = writing
      }
    }).catch((error) => { options.onError?.(error); throw error })
    running = operation
    void operation.finally(() => { if (running === operation) running = null }).catch(() => undefined)
    return operation
  }
  return {
    schedule() {
      revision++
      if (timer !== null) return
      timer = setTimeout(() => { timer = null; void drain().catch(() => undefined) }, options.debounceMs)
    },
    cancel() { clear(); saved = revision },
    async drain() {
      const pending = saved < revision
      await drain()
      if (pending) options.onDrain?.()
    },
  }
}
