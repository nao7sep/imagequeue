import { useCallback } from 'react'
import { Modal } from './Modal'
import { useDependencies } from '../context/DependenciesContext'
import { formatUiDateTime } from '../utils/formatDateTime'
import type {
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
  if (!info.installedLabel) return `Version unreadable${latest}${updated}`
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
  const {
    state,
    busy,
    progress,
    error,
    terminalOutcomes,
    check,
    installCli,
    installRecommendations,
    setCheckAtLaunch,
    cancelOperations,
  } = useDependencies()
  const anyBusy = busy.size > 0

  // The application controller outlives this replaceable modal. Closing while an
  // operation is active explicitly asks that controller to cancel and then hides
  // the view immediately; terminal reconciliation continues outside the modal.
  const requestClose = useCallback((): void => {
    // The application owner checks its live operation registry. Do not infer
    // cancellation correctness from this replaceable view's rendered flags.
    void cancelOperations()
    onClose()
  }, [cancelOperations, onClose])

  return (
    <Modal
      title="Managed tools"
      className="dependencies-modal-box"
      onClose={requestClose}
      closeOnBackdropClick
      footer={
        <>
          <button
            type="button"
            className="modal-btn modal-footer-lead"
            disabled={anyBusy}
            onClick={() => { void check() }}
          >
            {busy.has('check') ? 'Checking…' : 'Check for CLI updates'}
          </button>
          {!busy.has('check') && terminalOutcomes.check === 'cancelled' && (
            <span className="dependency-terminal-outcome">Check cancelled</span>
          )}
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

        {!state && !error && <div className="dependencies-intro">Loading managed tools…</div>}
        {!state && error && (
          <div className="dependencies-intro">Couldn’t load managed-tool status.</div>
        )}

        {state && (
          <>
            <DependencyRow
              title="Draw Things CLI"
              description="The image-generation engine. Downloaded from the official release and verified against its published checksum."
              info={state.cli}
              busy={busy.has('cli')}
              disabled={busy.has('cli') || busy.has('check')}
              progress={busy.has('cli') ? progress : null}
              terminalOutcome={terminalOutcomes.cli}
              onAction={() => { void installCli() }}
            />
            <DependencyRow
              title="Recommended parameters"
              description="Versionless per-model defaults (configs.json) from Draw Things. Optional — Install or Refresh fetches the current file; generation falls back to your defaults without it."
              info={state.recommendations}
              busy={busy.has('recommendations')}
              disabled={busy.has('recommendations') || busy.has('check')}
              progress={null}
              terminalOutcome={terminalOutcomes.recommendations}
              onAction={() => { void installRecommendations() }}
            />

            <label className="dependencies-toggle">
              <input
                type="checkbox"
                checked={state.checkUpdatesAtLaunch}
                disabled={busy.has('toggle') || busy.has('check')}
                onChange={(e) => { void setCheckAtLaunch(e.target.checked) }}
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
  terminalOutcome,
  onAction,
}: {
  title: string
  description: string
  info: DependencyInfo
  busy: boolean
  disabled: boolean
  progress: DependencyProgress | null
  terminalOutcome: 'cancelled' | undefined
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
          {info.id === 'cli' && (
            <>
              {' · '}
              {info.lastCheckedAtUtc
                ? `checked ${formatUiDateTime(info.lastCheckedAtUtc)}`
                : 'never checked'}
            </>
          )}
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
        <div className="dependency-actions">
          {!busy && terminalOutcome === 'cancelled' && (
            <span className="dependency-terminal-outcome">Cancelled</span>
          )}
          <button
            type="button"
            className="dependency-action"
            disabled={disabled}
            onClick={onAction}
          >
            {busy ? 'Working…' : actionLabel}
          </button>
        </div>
      )}
    </section>
  )
}
