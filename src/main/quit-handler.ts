export interface QuitEvent { preventDefault(): void }
export type QuitChoice = 'retry' | 'quit' | 'cancel'

interface QuitOptions {
  // Ordinary quit asks before ending live work; true without asking when
  // nothing would be lost. OS takeover never asks.
  confirm: (signal: AbortSignal) => boolean | Promise<boolean>
  declined: () => void
  begin: () => void
  save: () => Promise<void>
  cleanup: () => Promise<void>
  cancel: () => void
  question: (signal: AbortSignal) => Promise<QuitChoice>
  exit: (code: number) => void
  timeoutMs: number
  systemTimeoutMs: number
  onError: (error: unknown) => void
}

/** One attempt owns the confirmation, saves and the decision, under one exit
 * deadline fixed when the quit begins: the required saves and then the optional
 * cleanup draw on what remains of it, and an answered question starts it again.
 * Nothing is stopped before the user confirms. A save that fails, or is still
 * running when the deadline ends, is not consent: the ordinary quit asks, and
 * Retry runs the save again through its owners, so it queues behind a write
 * still running. OS takeover owns one deadline of its own from the takeover. */
export function createQuitOwner(options: QuitOptions) {
  let active: Promise<void> | null = null
  let system = false
  let exited = false
  let deadline = 0
  let systemTimer: ReturnType<typeof setTimeout> | undefined
  let question: AbortController | null = null
  const finish = (): void => {
    if (exited) return
    exited = true
    clearTimeout(systemTimer)
    question?.abort()
    options.exit(0)
  }
  // True when the work settled before the exit deadline, false when it did not.
  const withinDeadline = async (work: Promise<void>): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([work.then(() => true), new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, deadline - performance.now()))
      })])
    } finally { clearTimeout(timer) }
  }
  const run = async (): Promise<void> => {
    // A quit with nothing to lose seals at once; otherwise the user decides
    // first, unless the OS takes over meanwhile.
    if (!system) {
      question = new AbortController()
      let proceed: boolean
      try {
        const answer = options.confirm(question.signal)
        proceed = answer === true || (answer !== false && await answer)
      } catch (error) {
        options.onError(error)
        proceed = false
      } finally { question = null }
      if (exited) return
      if (!proceed && !system) { options.declined(); return }
    }
    if (!system) deadline = performance.now() + options.timeoutMs
    options.begin()
    while (!exited) {
      let saved = false
      try {
        saved = await withinDeadline(Promise.resolve().then(options.save))
        if (!saved) options.onError(new Error('Saving before quit had not finished at the exit deadline'))
      } catch (error) {
        options.onError(error)
      }
      if (exited) return
      if (saved) {
        // Optional work has what remains of the deadline, and none on session end.
        if (!system) {
          try { await withinDeadline(Promise.resolve().then(options.cleanup)) }
          catch (error) { options.onError(error) }
        }
        finish()
        return
      }
      if (system) { finish(); return }
      question = new AbortController()
      let choice: QuitChoice = 'cancel'
      try { choice = await options.question(question.signal) }
      catch (error) { options.onError(error) }
      finally { question = null }
      if (exited) return
      // OS takeover dismissed the question: attempt the preserved saves again.
      if (system) continue
      if (choice === 'quit') { finish(); return }
      if (choice === 'retry') {
        deadline = performance.now() + options.timeoutMs
        continue
      }
      options.cancel()
      return
    }
  }
  const start = (): void => {
    if (active || exited) return
    const operation = run().catch((error) => {
      options.onError(error)
      if (system) finish()
      else options.cancel()
    })
    active = operation
    void operation.finally(() => { if (active === operation) active = null })
  }
  return {
    beforeQuit(event: QuitEvent): void { event.preventDefault(); start() },
    sessionEnd(): void {
      if (system || exited) return
      system = true
      deadline = performance.now() + options.systemTimeoutMs
      systemTimer = setTimeout(finish, options.systemTimeoutMs)
      question?.abort()
      start()
    },
  }
}
