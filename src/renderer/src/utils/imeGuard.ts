import { useEffect } from 'react'

interface ComposingSignals {
  isComposing?: boolean
  keyCode?: number
}

interface Scheduler {
  schedule: (callback: () => void) => number
  cancel: (handle: number) => void
}

// Core IME-composition guard, deliberately decoupled from the DOM and from
// timers (the scheduler is injected) so the stateful logic — including the
// one-tick hold after compositionend — is unit-testable without a browser.
//
// A custom keyboard-submit handler asks `isComposing(event)` before acting. The
// guard reports composing when:
//   - a composition is currently active (compositionstart seen, not yet ended), OR
//   - the event itself reports it (`isComposing`, or the legacy `keyCode === 229`
//     "IME processing" sentinel that some older WebKit builds still send).
//
// `end()` holds `composing` true for one tick because WebKit/Safari can deliver
// the final Enter keydown AFTER compositionend (when `event.isComposing` is
// already false). `cancel()` ends composition immediately — used when focus
// leaves the composing element, so a skipped compositionend can never leave the
// flag stuck true and silently swallow later submits.
export class ImeGuard {
  private composing = false
  private pendingHandle: number | null = null

  constructor(private readonly scheduler: Scheduler) {}

  start(): void {
    this.clearPending()
    this.composing = true
  }

  end(): void {
    this.clearPending()
    this.pendingHandle = this.scheduler.schedule(() => {
      this.composing = false
      this.pendingHandle = null
    })
  }

  cancel(): void {
    this.clearPending()
    this.composing = false
  }

  isComposing(event?: ComposingSignals): boolean {
    if (this.composing) return true
    if (!event) return false
    if (event.isComposing) return true
    // `keyCode` is deprecated; read defensively. If a browser drops it the value
    // is undefined and this branch simply never matches.
    return event.keyCode === 229
  }

  private clearPending(): void {
    if (this.pendingHandle !== null) {
      this.scheduler.cancel(this.pendingHandle)
      this.pendingHandle = null
    }
  }
}

const animationFrameScheduler: Scheduler = {
  schedule: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle)
}

// One shared guard for the whole renderer; `useImeGuard` ref-counts the DOM
// listeners that feed it. `focusout` is the safety net: if focus leaves a
// composing element and the browser skips compositionend, composition still ends.
const sharedGuard = new ImeGuard(animationFrameScheduler)
let listenerRefCount = 0

const handleCompositionStart = (): void => sharedGuard.start()
const handleCompositionEnd = (): void => sharedGuard.end()
const handleFocusOut = (): void => sharedGuard.cancel()

function isImeComposing(event?: ComposingSignals): boolean {
  return sharedGuard.isComposing(event)
}

// Mounts shared, ref-counted document listeners that keep the guard current, and
// returns the `isImeComposing` check. Call once in any component whose key
// handlers need IME safety; multiple callers share one guard.
export function useImeGuard(): typeof isImeComposing {
  useEffect(() => {
    if (listenerRefCount === 0) {
      document.addEventListener('compositionstart', handleCompositionStart, true)
      document.addEventListener('compositionend', handleCompositionEnd, true)
      document.addEventListener('focusout', handleFocusOut, true)
    }
    listenerRefCount += 1
    return () => {
      listenerRefCount -= 1
      if (listenerRefCount === 0) {
        document.removeEventListener('compositionstart', handleCompositionStart, true)
        document.removeEventListener('compositionend', handleCompositionEnd, true)
        document.removeEventListener('focusout', handleFocusOut, true)
        sharedGuard.cancel()
      }
    }
  }, [])
  return isImeComposing
}
