import type { DependenciesState, DependencyInfo } from '../../../shared/types'
import { useDependencies } from '../context/DependenciesContext'

// The single pane pointer to the Dependencies modal for the Draw Things column.
// Its only job is to lead the user to the modal — it carries no actions of its
// own. It decides its own visibility from the dependency state, following the
// convention's display models:
//   - everything fine                  → silent (renders nothing)
//   - CLI missing, or update available → WARN, shown until resolved
//   - configs.json missing / unchecked → INFO, normal muted ink, also permanent
//
// Both roles show PERMANENTLY (fleet decision, 2026-08-21, superseding the old
// 30-second temporary info): this pointer is the one standing path to notice the
// Draw Things tools are missing or may be stale — a nudge that hides leaves only
// the menu item, which nothing points at. It sits among the column's other
// state-driven rows (which themselves appear once the CLI is installed), so it
// shifts no app chrome.
//
// Draw Things is one optional backend among several, so app-wide its
// dependencies are OPTIONAL: nothing blocks first-run and nothing interrupts.
// But required-ness follows the surface's scope, and within THIS pane the CLI is
// required — the whole column is dead without it, exactly as a provider column
// is dead without its API key, whose row already warns. So a missing CLI warns
// here, while the recommendations file — genuine garnish generation works fully
// without — stays informational when absent.

type Severity = 'warn' | 'info'

// `requiredInPane` is the scope rule from the header: the CLI's absence warns
// because this pane cannot work without it; the recommendations file's does not.
function isWarn(dep: DependencyInfo, requiredInPane: boolean): boolean {
  if (dep.state === 'update-available') return true
  return requiredInPane && dep.state === 'not-installed'
}

function isInfo(dep: DependencyInfo): boolean {
  return dep.state === 'not-installed' || dep.state === 'installed-unchecked'
}

function severityFor(state: DependenciesState): Severity | null {
  if (isWarn(state.cli, true) || isWarn(state.recommendations, false)) return 'warn'
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
  // Two different informational stories, told apart: a present CLI whose version
  // could not be read needs re-acquiring (the modal's Update), where a
  // merely-unchecked one only needs a check.
  if (state.cli.state === 'installed-unchecked' && !state.cli.installedLabel) {
    return 'Draw Things CLI version unreadable'
  }
  return 'Draw Things dependencies not checked'
}

export function DependencyPanePointer(): React.JSX.Element | null {
  const { state } = useDependencies()

  const severity = state?.platformSupported ? severityFor(state) : null
  const summary = state ? summarize(state) : ''

  if (!severity) return null

  return (
    <button
      type="button"
      className={`dep-pane-pointer dep-pane-pointer-${severity}`}
      onClick={() => window.dispatchEvent(new CustomEvent('open-dependencies-modal'))}
    >
      {summary} — open Managed tools
    </button>
  )
}
