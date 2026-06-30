import { useCallback, useEffect, useState } from 'react'
import type { DependenciesState, DependencyInfo } from '../../../shared/types'

// The single pane pointer to the Dependencies modal for the Draw Things column.
// Its only job is to lead the user to the modal — it carries no actions of its
// own. It decides its own visibility from the dependency state, following the
// convention's display models:
//   - everything fine            → silent (renders nothing)
//   - an update is available     → WARN, shown persistently until resolved
//   - optional setup / unchecked → INFO, shown temporarily then auto-hidden
//
// Draw Things is one optional backend among several, so its dependencies are
// OPTIONAL: an absent CLI or configs.json is informational (the convention's
// optional-absent), never a warning and never a blocking first-run. The
// always-present Dependencies menu item is the permanent way in; this pointer is
// the temporary nudge. Only an available update — "you're behind" — is a WARN.

const TEMPORARY_VISIBLE_MS = 30_000

type Severity = 'warn' | 'info'

function isWarn(dep: DependencyInfo): boolean {
  return dep.state === 'update-available'
}

function isInfo(dep: DependencyInfo): boolean {
  return dep.state === 'not-installed' || dep.state === 'installed-unchecked'
}

function severityFor(state: DependenciesState): Severity | null {
  if (isWarn(state.cli) || isWarn(state.recommendations)) return 'warn'
  if (isInfo(state.cli) || isInfo(state.recommendations)) return 'info'
  return null
}

// The single most important thing to say — the pointer names it, the modal owns
// the detail. Order is by urgency: a missing CLI blocks the backend entirely.
function summarize(state: DependenciesState): string {
  if (state.cli.state === 'not-installed') return 'Draw Things CLI is not installed'
  if (state.cli.state === 'update-available') return 'Draw Things CLI update available'
  if (state.recommendations.state === 'update-available') return 'Recommended parameters update available'
  if (state.recommendations.state === 'not-installed') return 'Recommended parameters not downloaded'
  return 'Draw Things dependencies not checked'
}

export function DependencyPanePointer(): React.JSX.Element | null {
  const [state, setState] = useState<DependenciesState | null>(null)
  const [temporaryElapsed, setTemporaryElapsed] = useState(false)

  const refresh = useCallback((): void => {
    void window.electronAPI.getDependenciesState().then(setState)
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('dependencies-changed', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('dependencies-changed', refresh)
    }
  }, [refresh])

  const severity = state?.platformSupported ? severityFor(state) : null
  const summary = state ? summarize(state) : ''

  // Restart the temporary timer whenever the message changes; a WARN never times
  // out (the cleanup just clears any prior timer).
  useEffect(() => {
    setTemporaryElapsed(false)
    if (severity !== 'info') return
    const id = window.setTimeout(() => setTemporaryElapsed(true), TEMPORARY_VISIBLE_MS)
    return () => window.clearTimeout(id)
  }, [severity, summary])

  if (!severity) return null
  if (severity === 'info' && temporaryElapsed) return null

  return (
    <button
      type="button"
      className={`dep-pane-pointer dep-pane-pointer-${severity}`}
      onClick={() => window.dispatchEvent(new CustomEvent('open-dependencies-modal'))}
    >
      {summary} — open Dependencies
    </button>
  )
}
