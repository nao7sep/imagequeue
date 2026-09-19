import { useCallback } from 'react'
import { Modal } from './Modal'
import { useDependencies } from '../context/DependenciesContext'
import { formatUiDateTime } from '../utils/formatDateTime'
import type {
  DependenciesState,
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
    if (info.state === 'not-installed') return 'Install'
    return info.state === 'update-available' ? 'Update' : 'Refresh'
  }
  if (info.state === 'not-installed') return 'Install'
  if (info.state === 'update-available') return 'Update'
  if (info.state === 'installed-unchecked' && !info.installedLabel) return 'Update'
  return null
}

// Check covers every tool, so the set was last checked when its least recently
// checked tool was. A present tool never checked leaves the set unchecked; an
// absent file has nothing to check against.
function lastSetCheck(state: DependenciesState): string | null {
  const times = [state.cli.lastCheckedAtUtc]
  if (state.recommendations.state !== 'not-installed') times.push(state.recommendations.lastCheckedAtUtc)
  if (times.some((time) => !time)) return null
  return (times as string[]).sort()[0]
}

function installedSummary(info: DependencyInfo): string {
  if (info.state === 'not-installed') return 'None'
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
  const lastChecked = state ? lastSetCheck(state) : null

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
        <button
          type="button"
          className="modal-btn"
          onClick={requestClose}
        >
          {anyBusy ? 'Cancel and close' : 'Close'}
        </button>
      }
    >
      <div className="dependencies-body">
        <p className="dependencies-intro">
          ImageQueue manages these for the Draw Things backend. Nothing is
          installed or updated without your go-ahead.
        </p>

        {error && <div className="dependencies-error" role="alert">{error}</div>}

        {!state && !error && <div className="dependencies-intro">Loading managed tools…</div>}
        {!state && error && (
          <div className="dependencies-intro">Couldn’t load managed-tool status.</div>
        )}

        {state && (
          <>
            <DependencySection
              title="Draw Things CLI"
              description="The image-generation engine, from the official Draw Things Community release and verified against its published checksum."
              required
              info={state.cli}
              busy={busy.has('cli')}
              disabled={busy.has('cli') || busy.has('check')}
              progress={busy.has('cli') ? progress : null}
              terminalOutcome={terminalOutcomes.cli}
              onAction={() => { void installCli() }}
            />
            <DependencySection
              title="Recommended parameters"
              description="Per-model default settings (configs.json) from Draw Things. Without them, generation uses your own defaults."
              required={false}
              info={state.recommendations}
              busy={busy.has('recommendations')}
              disabled={busy.has('recommendations') || busy.has('check')}
              progress={null}
              terminalOutcome={terminalOutcomes.recommendations}
              onAction={() => { void installRecommendations() }}
            />
            <section className="dependency-row">
              <div className="dependency-heading">
                <h3 className="dependency-title">Updates</h3>
              </div>
              <p className="dependency-desc">
                Checking asks each tool’s source what is current. Nothing is downloaded.
              </p>
              <div className="dependency-facts">
                <DependencyFact
                  label="Last checked"
                  actions={
                    <>
                      {!busy.has('check') && terminalOutcomes.check === 'cancelled' && (
                        <span className="dependency-terminal-outcome" role="status">Check cancelled</span>
                      )}
                      <button
                        type="button"
                        className="modal-btn"
                        disabled={anyBusy}
                        onClick={() => { void check() }}
                      >
                        {busy.has('check') ? 'Checking…' : 'Check for updates'}
                      </button>
                    </>
                  }
                >
                  <span className="dependency-fact-line">
                    {lastChecked ? formatUiDateTime(lastChecked) : 'Never'}
                  </span>
                  <label className="dependencies-toggle">
                    <input
                      type="checkbox"
                      checked={state.checkUpdatesAtLaunch}
                      disabled={busy.has('toggle') || busy.has('check')}
                      onChange={(e) => { void setCheckAtLaunch(e.target.checked) }}
                    />
                    Check for updates at launch
                  </label>
                </DependencyFact>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}

// One labelled line of a dependency's state, with the action that changes it
// at the line's end.
function DependencyFact({
  label,
  actions,
  children,
}: {
  label: string
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="dependency-fact">
      <span className="dependency-fact-label">{label}</span>
      <div className="dependency-fact-value">{children}</div>
      {actions && <div className="dependency-fact-actions">{actions}</div>}
    </div>
  )
}

function DependencySection({
  title,
  description,
  required,
  info,
  busy,
  disabled,
  progress,
  terminalOutcome,
  onAction,
}: {
  title: string
  description: string
  required: boolean
  info: DependencyInfo
  busy: boolean
  disabled: boolean
  progress: DependencyProgress | null
  terminalOutcome: 'cancelled' | undefined
  onAction: () => void
}): React.JSX.Element {
  const actionLabel = actionLabelFor(info)
  const pct = progress ? progressPercent(progress) : null
  // The action carries the accent only when it is the step the user is owed:
  // a required tool that is missing, or a newer version waiting.
  const emphasized =
    (required && info.state === 'not-installed') || info.state === 'update-available'

  return (
    <section className="dependency-row">
      <div className="dependency-heading">
        <h3 className="dependency-title">{title}</h3>
        {!required && <span className="dependency-optional">Optional</span>}
        <span
          className={`dependency-badge dependency-badge-${info.state}${
            info.state === 'not-installed' && required ? ' dependency-badge-required' : ''
          }`}
        >
          {STATE_LABEL[info.state]}
        </span>
      </div>
      <p className="dependency-desc">{description}</p>
      <div className="dependency-facts">
        <DependencyFact
          label="Installed"
          actions={
            actionLabel && (
              <>
                {!busy && terminalOutcome === 'cancelled' && (
                  <span className="dependency-terminal-outcome" role="status">Cancelled</span>
                )}
                <button
                  type="button"
                  className={`modal-btn${emphasized ? ' modal-btn-primary' : ''}`}
                  disabled={disabled}
                  onClick={onAction}
                >
                  {busy ? 'Working…' : actionLabel}
                </button>
              </>
            )
          }
        >
          <span className="dependency-fact-line dependency-meta">{installedSummary(info)}</span>
          {busy && progress && (
            <div className="dependency-progress">
              <div
                className="dependency-progress-bar"
                role="progressbar"
                aria-label={`${title} installation progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
              >
                <div
                  className="dependency-progress-fill"
                  style={pct === null ? { width: '100%', opacity: 0.4 } : { width: `${pct}%` }}
                />
              </div>
              <span className="dependency-progress-label">{progressLabel(progress)}</span>
            </div>
          )}
        </DependencyFact>
      </div>
    </section>
  )
}
