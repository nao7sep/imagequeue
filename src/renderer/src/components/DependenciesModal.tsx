import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { formatUiDateTime } from '../utils/formatDateTime'
import type {
  DependenciesState,
  DependencyId,
  DependencyInfo,
  DependencyProgress,
  DependencyState,
} from '../../../shared/types'
import './DependenciesModal.css'

interface Props {
  onClose: () => void
}

const STATE_LABEL: Record<DependencyState, string> = {
  'not-installed': 'Not installed',
  'up-to-date': 'Up to date',
  'update-available': 'Update available',
  'installed-unchecked': 'Installed (not checked)',
}

// State → action verb. Install (absent), Update (newer available) — and Update
// again when a present dependency's own version could not be read, which is the
// only way out of that row: the CLI metadata check resolves the LATEST,
// so it can never clear an unreadable INSTALLED version, and re-acquiring is what
// replaces the copy that would not answer. A current dependency, or one merely
// unchecked with its version in hand, offers no button — Check is that move.
function actionLabelFor(info: DependencyInfo): string | null {
  if (info.id === 'recommendations') {
    return info.state === 'not-installed' ? 'Install' : 'Refresh'
  }
  if (info.state === 'not-installed') return 'Install'
  if (info.state === 'update-available') return 'Update'
  if (info.state === 'installed-unchecked' && !info.installedLabel) return 'Update'
  return null
}

function installedSummary(info: DependencyInfo): string {
  if (info.state === 'not-installed') return 'Not installed'
  const updated = info.updatedAtUtc ? ` · updated ${formatUiDateTime(info.updatedAtUtc)}` : ''
  const latest =
    info.state === 'update-available' && info.latestLabel ? ` → ${info.latestLabel}` : ''
  // Present, but it did not say what it is — an installed binary whose sidecar is
  // missing. "Not installed" would be a lie, and silence would leave the row
  // looking fine.
  if (!info.installedLabel) return `version unreadable${latest}${updated}`
  return `${info.installedLabel}${latest}${updated}`
}

function progressPercent(progress: DependencyProgress): number | null {
  if (progress.phase !== 'downloading' || !progress.totalBytes) return null
  return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
}

function progressLabel(progress: DependencyProgress): string {
  if (progress.phase === 'verifying') return 'Verifying…'
  if (progress.phase === 'installing') return 'Installing…'
  const pct = progressPercent(progress)
  return pct === null ? 'Downloading…' : `Downloading… ${pct}%`
}

export function DependenciesModal({ onClose }: Props): React.JSX.Element {
  const [state, setState] = useState<DependenciesState | null>(null)
  // Operations in flight, by id. A set (not a single value) so the two downloads —
  // the CLI and configs.json — can run at the same time; they touch different
  // files. The CLI metadata 'check' is serialized in this modal with row actions;
  // 'toggle' is the launch checkbox.
  const [busy, setBusy] = useState<ReadonlySet<DependencyId | 'check' | 'toggle'>>(() => new Set())
  const [progress, setProgress] = useState<DependencyProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const anyBusy = busy.size > 0

  useEffect(() => {
    void window.electronAPI.getDependenciesState().then(setState)
  }, [])

  useEffect(() => {
    return window.electronAPI.onDependencyProgress(setProgress)
  }, [])

  // Closing while an operation is active cancels its main-process controller,
  // then closes immediately. The operation owns its staging cleanup, so the user
  // is never trapped in this modal and no partial artifact is published.
  const requestClose = useCallback((): void => {
    if (busy.size > 0) void window.electronAPI.cancelDependencyOperations()
    onClose()
  }, [busy, onClose])

  // After any mutation, the column and pane pointer re-read from main.
  const broadcastChange = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('dependencies-changed'))
  }, [])

  // Run one operation: mark its id busy, apply the returned snapshot, and surface
  // a clean error. Functional set updates so concurrent ops don't clobber each
  // other's busy entry. Operations never partially apply (the main side leaves no
  // half-state), so each returned snapshot is authoritative; the later of two
  // concurrent ops reflects both effects.
  const run = useCallback(
    async (id: DependencyId | 'check' | 'toggle', op: () => Promise<DependenciesState>): Promise<void> => {
      setBusy((prev) => new Set(prev).add(id))
      setError(null)
      try {
        setState(await op())
        broadcastChange()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        // An acquisition can fail after a durable local effect (for example,
        // binary publication before its sidecar write). Re-read local facts so
        // the UI remains honest while retaining the actionable operation error.
        try {
          setState(await window.electronAPI.getDependenciesState())
          broadcastChange()
        } catch {
          // Keep the operation error, which is the actionable failure.
        }
      } finally {
        setBusy((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        // Only the CLI install drives the progress bar; don't clear it when a
        // concurrent configs.json download finishes first.
        if (id === 'cli') setProgress(null)
      }
    },
    [broadcastChange]
  )

  const handleCheck = (): Promise<void> =>
    run('check', () => window.electronAPI.checkDependencies())

  const handleCliAction = (): Promise<void> =>
    run('cli', () => window.electronAPI.installCli())

  const handleRecommendationsAction = (): Promise<void> =>
    run('recommendations', () => window.electronAPI.downloadRecommendations())

  const handleToggleCheckAtLaunch = (value: boolean): Promise<void> =>
    run('toggle', () => window.electronAPI.setCheckUpdatesAtLaunch(value))

  return (
    <Modal
      title="Dependencies"
      className="dependencies-modal-box"
      onClose={requestClose}
      closeOnBackdropClick
      footer={
        <>
          <button
            type="button"
            className="modal-btn modal-footer-lead"
            disabled={anyBusy}
            onClick={() => { void handleCheck() }}
          >
            {busy.has('check') ? 'Checking…' : 'Check for CLI updates'}
          </button>
          <button
            type="button"
            className="modal-btn"
            onClick={requestClose}
          >
            {anyBusy ? 'Cancel and close' : 'Close'}
          </button>
        </>
      }
    >
      <div className="dependencies-body">
        <p className="dependencies-intro">
          ImageQueue manages these for the Draw Things backend. Nothing is
          installed or updated without your go-ahead.
        </p>

        {error && <div className="dependencies-error">{error}</div>}

        {state && (
          <>
            <DependencyRow
              title="Draw Things CLI"
              description="The image-generation engine. Downloaded from the official release and verified against its published checksum."
              info={state.cli}
              busy={busy.has('cli')}
              disabled={busy.has('cli') || busy.has('check')}
              progress={busy.has('cli') ? progress : null}
              onAction={() => { void handleCliAction() }}
            />
            <DependencyRow
              title="Recommended parameters"
              description="Versionless per-model defaults (configs.json) from Draw Things. Optional — Install or Refresh fetches the current file; generation falls back to your defaults without it."
              info={state.recommendations}
              busy={busy.has('recommendations')}
              disabled={busy.has('recommendations') || busy.has('check')}
              progress={null}
              onAction={() => { void handleRecommendationsAction() }}
            />

            <label className="dependencies-toggle">
              <input
                type="checkbox"
                checked={state.checkUpdatesAtLaunch}
                disabled={busy.has('toggle') || busy.has('check')}
                onChange={(e) => { void handleToggleCheckAtLaunch(e.target.checked) }}
              />
              Check for CLI updates at launch
            </label>
          </>
        )}
      </div>
    </Modal>
  )
}

function DependencyRow({
  title,
  description,
  info,
  busy,
  disabled,
  progress,
  onAction,
}: {
  title: string
  description: string
  info: DependencyInfo
  busy: boolean
  disabled: boolean
  progress: DependencyProgress | null
  onAction: () => void
}): React.JSX.Element {
  const actionLabel = actionLabelFor(info)
  const pct = progress ? progressPercent(progress) : null

  return (
    <section className="dependency-row">
      <div className="dependency-main">
        <div className="dependency-heading">
          <h3 className="dependency-title">{title}</h3>
          <span className={`dependency-badge dependency-badge-${info.state}`}>
            {STATE_LABEL[info.state]}
          </span>
        </div>
        <p className="dependency-desc">{description}</p>
        <p className="dependency-meta">
          {installedSummary(info)}
          {' · '}
          {info.lastCheckedAtUtc
            ? `checked ${formatUiDateTime(info.lastCheckedAtUtc)}`
            : 'never checked'}
        </p>
        {busy && progress && (
          <div className="dependency-progress">
            <div className="dependency-progress-bar">
              <div
                className="dependency-progress-fill"
                style={pct === null ? { width: '100%', opacity: 0.4 } : { width: `${pct}%` }}
              />
            </div>
            <span className="dependency-progress-label">{progressLabel(progress)}</span>
          </div>
        )}
      </div>
      {actionLabel && (
        <button
          type="button"
          className="dependency-action"
          disabled={disabled}
          onClick={onAction}
        >
          {busy ? 'Working…' : actionLabel}
        </button>
      )}
    </section>
  )
}
