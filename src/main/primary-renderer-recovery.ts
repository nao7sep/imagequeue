interface RendererLoss {
  reason: string
  exitCode: number
}

interface PrimaryRendererOptions {
  load: () => Promise<void>
  isDestroyed: () => boolean
  onStartupFailure: (error: unknown) => void
  onRuntimeFailure: (error: unknown) => void
}

/** Reload only the view: queues, session drafts and admitted work stay in main.
 * Each explicit restore gets at most one attempt, shared by overlapping restores. */
export class PrimaryRendererRecovery {
  private loadedOnce = false
  private broken = false
  private revision = 0
  private pending: Promise<boolean> | null = null

  constructor(private readonly options: PrimaryRendererOptions) {}

  start(): void { void this.load() }

  isReady(): boolean { return this.loadedOnce && !this.broken && !this.options.isDestroyed() }

  rendererGone(details: RendererLoss): void {
    if (this.options.isDestroyed()) return
    this.revision++
    this.broken = true
    const error = new Error('The primary renderer terminated', { cause: details })
    if (this.loadedOnce) this.options.onRuntimeFailure(error)
    else this.options.onStartupFailure(error)
  }

  restore(): Promise<boolean> {
    if (this.options.isDestroyed()) return Promise.resolve(false)
    if (!this.broken) return Promise.resolve(true)
    return this.pending ?? this.load()
  }

  private load(): Promise<boolean> {
    const revision = ++this.revision
    const operation = (async (): Promise<boolean> => {
      try {
        await this.options.load()
        if (revision !== this.revision || this.options.isDestroyed()) return false
        this.loadedOnce = true
        this.broken = false
        return true
      } catch (error) {
        if (revision !== this.revision || this.options.isDestroyed()) return false
        this.broken = true
        if (this.loadedOnce) this.options.onRuntimeFailure(error)
        else this.options.onStartupFailure(error)
        return false
      }
    })()
    const tracked = operation.finally(() => {
      if (this.pending === tracked) this.pending = null
    })
    this.pending = tracked
    return tracked
  }
}
