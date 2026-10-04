export interface QuitEvent {
  preventDefault(): void
}

interface BeforeQuitOptions {
  // Starts shutdown; its synchronous part runs inside the first quit's event.
  shutdown: () => Promise<void>
  exit: (code: number) => void
  timeoutMs: number
  onError: (error: unknown) => void
  onTimeout: () => void
}

/**
 * The before-quit handler. Every quit is held: the first starts shutdown, and
 * one arriving while it runs only waits for it, so the process ends once, by
 * `exit(0)`, after shutdown settles or the bound passes (PLAYBOOK, Own the work
 * in flight; Bound every external wait).
 */
export function createBeforeQuitHandler(options: BeforeQuitOptions): (event: QuitEvent) => void {
  let started = false
  return (event) => {
    event.preventDefault()
    if (started) return
    started = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        options.onTimeout()
        resolve()
      }, options.timeoutMs)
    })
    const finished = options.shutdown().catch(options.onError)
    void Promise.race([finished, bound]).finally(() => {
      clearTimeout(timer)
      options.exit(0)
    })
  }
}
