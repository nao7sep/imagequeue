export interface QuitEvent { preventDefault(): void }
export type QuitChoice = 'retry' | 'quit' | 'cancel'

interface QuitOptions {
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

/** One attempt owns saves and the decision; OS takeover owns a single deadline.
 * A timed-out save remains owned until physical settlement, so Retry never
 * races a second writer against it. Ordinary timeout is a failure, not consent. */
export function createQuitOwner(options: QuitOptions) {
  let active: Promise<void> | null = null
  let system = false
  let exited = false
  let systemTimer: ReturnType<typeof setTimeout> | undefined
  let question: AbortController | null = null
  let saving: Promise<void> | null = null
  let attempt = 0
  let savingAttempt = 0
  const finish = (): void => {
    if (exited) return
    exited = true
    clearTimeout(systemTimer)
    question?.abort()
    options.exit(0)
  }
  const save = (): Promise<void> => {
    // Cancel can leave a physical write settling. A later quit waits for it,
    // then captures edits made since Cancel rather than reusing its old save.
    if (saving && savingAttempt !== attempt) return saving.then(save, save)
    if (!saving) {
      const operation = Promise.resolve().then(options.save)
      saving = operation
      savingAttempt = attempt
      void operation.finally(() => { if (saving === operation) saving = null }).catch(() => undefined)
    }
    return saving
  }
  const boundedSave = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([save(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Saving before quit timed out')), options.timeoutMs)
      })])
    } finally { clearTimeout(timer) }
  }
  const run = async (): Promise<void> => {
    attempt++
    options.begin()
    while (!exited) {
      try {
        await boundedSave()
        if (exited) return
        // Optional work has a small ordinary budget and none on session end.
        if (!system) {
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([options.cleanup(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 500) })])
          } catch (error) { options.onError(error) }
          finally { clearTimeout(timer) }
        }
        finish()
        return
      } catch (error) {
        options.onError(error)
        if (system) { finish(); return }
        question = new AbortController()
        let choice: QuitChoice = 'cancel'
        try { choice = await options.question(question.signal) }
        catch (error) { options.onError(error) }
        finally { question = null }
        if (system || exited) return
        if (choice === 'quit') { finish(); return }
        if (choice === 'retry') continue
        options.cancel()
        return
      }
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
      systemTimer = setTimeout(finish, options.systemTimeoutMs)
      question?.abort()
      start()
      // If takeover dismissed a question, attempt the preserved saves again.
      void save().then(finish, (error) => { options.onError(error); finish() })
    },
  }
}
