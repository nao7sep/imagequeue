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

// State → action verb. Only Install (absent) and Update (newer available); a
// current or merely-unchecked dependency offers no button — the set-wide "Check
// for updates" is how an unchecked one gets resolved.
function actionLabelFor(state: DependencyState): string | null {
  if (state === 'not-installed') return 'Install'
  if (state === 'update-available') return 'Update'
  return null
}

function installedSummary(info: DependencyInfo): string {
  if (!info.installedLabel) return 'Not installed'
  const updated = info.updatedAtUtc ? ` · updated ${formatUiDateTime(info.updatedAtUtc)}` : ''
  const latest =
    info.state === 'update-available' && info.latestLabel ? ` → ${info.latestLabel}` : ''
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
  const [busy, setBusy] = useState<DependencyId | 'check' | null>(null)
  const [progress, setProgress] = useState<DependencyProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.electronAPI.getDependenciesState().then(setState)
  }, [])

  useEffect(() => {
    return window.electronAPI.onDependencyProgress(setProgress)
  }, [])

  // After any mutation, the column and pane pointer re-read from main.
  const broadcastChange = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('dependencies-changed'))
  }, [])

  // Run one operation: track which row is busy, apply the returned snapshot, and
  // surface a clean error. Operations never partially apply (the main side leaves
  // no half-state), so the snapshot is always authoritative.
  const run = useCallback(
    async (id: DependencyId | 'check', op: () => Promise<DependenciesState>): Promise<void> => {
      setBusy(id)
      setError(null)
      try {
        setState(await op())
        broadcastChange()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
        setProgress(null)
      }
    },
    [broadcastChange]
  )

  const handleCheck = (): Promise<void> =>
    run('check', () => window.electronAPI.checkDependencies())

  const handleCliAction = (): Promise<void> =>
    run('cli', () => window.electronAPI.installCli())

  const handleRecommendationsAction = (info: DependencyInfo): Promise<void> =>
    run('recommendations', () =>
      info.state === 'update-available'
        ? window.electronAPI.applyRecommendationsUpdate()
        : window.electronAPI.downloadRecommendations()
    )

  const handleToggleCheckAtLaunch = (value: boolean): Promise<void> =>
    run('check', () => window.electronAPI.setCheckUpdatesAtLaunch(value))

  return (
    <Modal
      title="Dependencies"
      className="dependencies-modal-box"
      onClose={onClose}
      footer={
        <div className="dependencies-footer">
          <button
            type="button"
            className="modal-btn"
            disabled={busy !== null}
            onClick={() => { void handleCheck() }}
          >
            {busy === 'check' ? 'Checking…' : 'Check for updates'}
          </button>
          <button type="button" className="modal-btn" onClick={onClose}>Close</button>
        </div>
      }
    >
      <div className="dependencies-body">
        <p className="dependencies-intro">
          ImageQueue downloads and verifies these for the Draw Things backend. Nothing is
          installed or updated without your go-ahead.
        </p>

        {error && <div className="dependencies-error">{error}</div>}

        {state && (
          <>
            <DependencyRow
              title="Draw Things CLI"
              description="The image-generation engine. Downloaded from the official release and verified against its published checksum."
              info={state.cli}
              busy={busy === 'cli'}
              disabled={busy !== null}
              progress={busy === 'cli' ? progress : null}
              onAction={() => { void handleCliAction() }}
            />
            <DependencyRow
              title="Recommended parameters"
              description="Per-model defaults (configs.json) from Draw Things. Optional — generation falls back to your defaults without it."
              info={state.recommendations}
              busy={busy === 'recommendations'}
              disabled={busy !== null}
              progress={null}
              onAction={() => { void handleRecommendationsAction(state.recommendations) }}
            />

            <label className="dependencies-toggle">
              <input
                type="checkbox"
                checked={state.checkUpdatesAtLaunch}
                disabled={busy !== null}
                onChange={(e) => { void handleToggleCheckAtLaunch(e.target.checked) }}
              />
              Check for updates at launch
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
  const actionLabel = actionLabelFor(info.state)
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
