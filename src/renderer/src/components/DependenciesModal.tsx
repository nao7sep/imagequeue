import { useCallback } from 'react'
import { Modal } from './Modal'
import { useDependencies } from '../context/DependenciesContext'
import { useI18n, type Translator } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
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

const STATE_LABEL: Record<DependencyState, MessageKey> = {
  'not-installed': 'dependencies.state.notInstalled',
  'up-to-date': 'dependencies.state.upToDate',
  'update-available': 'dependencies.state.updateAvailable',
  'installed-unchecked': 'dependencies.state.installedUnchecked',
}

// State → action verb. Install (absent), Update (newer available) — and Update
// again when a present dependency's own version could not be read, which is the
// only way out of that row: the CLI metadata check resolves the LATEST,
// so it can never clear an unreadable INSTALLED version, and re-acquiring is what
// replaces the copy that would not answer. A current dependency, or one merely
// unchecked with its version in hand, offers no button — Check is that move.
function actionLabelFor(info: DependencyInfo): MessageKey | null {
  if (info.id === 'recommendations') {
    if (info.state === 'not-installed') return 'dependencies.install'
    return info.state === 'update-available' ? 'dependencies.update' : 'dependencies.refresh'
  }
  if (info.state === 'not-installed') return 'dependencies.install'
  if (info.state === 'update-available') return 'dependencies.update'
  if (info.state === 'installed-unchecked' && !info.installedLabel) return 'dependencies.update'
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

function installedSummary(info: DependencyInfo, { t, dateTime }: Translator): string {
  if (info.state === 'not-installed') return t('dependencies.none')
  // What is installed: the CLI's tag, or the parameters file's entry count.
  // Present, but it did not say what it is — an installed binary whose sidecar
  // is missing, or a file that will not parse. "Not installed" would be a lie,
  // and silence would leave the row looking fine.
  let summary = info.id === 'recommendations'
    ? info.entryCount === null
      ? t('dependencies.fileUnreadable')
      : t('dependencies.entries', { count: info.entryCount })
    : info.installedLabel ?? t('dependencies.versionUnreadable')
  if (info.state === 'update-available' && info.latestLabel) {
    summary = t('dependencies.upgradeTo', { installed: summary, latest: info.latestLabel })
  }
  if (info.updatedAtUtc) {
    summary = t('dependencies.withUpdated', { summary, date: dateTime(info.updatedAtUtc) })
  }
  return summary
}

function progressPercent(progress: DependencyProgress): number | null {
  if (progress.phase !== 'downloading' || !progress.totalBytes) return null
  return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
}

function progressLabel(progress: DependencyProgress, { t }: Translator): string {
  if (progress.phase === 'verifying') return t('dependencies.verifying')
  if (progress.phase === 'installing') return t('dependencies.installing')
  const pct = progressPercent(progress)
  return pct === null ? t('dependencies.downloading') : t('dependencies.downloadingPercent', { percent: pct })
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
  const i18n = useI18n()
  const { t } = i18n
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
      title={t('dependencies.title')}
      className="dependencies-modal-box"
      onClose={requestClose}
      closeOnBackdropClick
      footer={
        <button
          type="button"
          className="modal-btn"
          onClick={requestClose}
        >
          {anyBusy ? t('dependencies.cancelAndClose') : t('common.close')}
        </button>
      }
    >
      <div className="dependencies-body">
        <p className="dependencies-intro">{t('dependencies.intro')}</p>

        {error && <div className="dependencies-error" role="alert">{i18n.text(error)}</div>}

        {!state && !error && <div className="dependencies-intro">{t('dependencies.loading')}</div>}
        {!state && error && (
          <div className="dependencies-intro">{t('dependencies.loadFailed')}</div>
        )}

        {state && (
          <>
            <DependencySection
              title={t('dependencies.cliTitle')}
              description={t('dependencies.cliDescription')}
              required
              info={state.cli}
              busy={busy.has('cli')}
              disabled={busy.has('cli') || busy.has('check')}
              progress={busy.has('cli') ? progress : null}
              terminalOutcome={terminalOutcomes.cli}
              onAction={() => { void installCli() }}
            />
            <DependencySection
              title={t('dependencies.recommendationsTitle')}
              description={t('dependencies.recommendationsDescription')}
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
                <h3 className="dependency-title">{t('dependencies.updatesTitle')}</h3>
              </div>
              <p className="dependency-desc">{t('dependencies.updatesDescription')}</p>
              <div className="dependency-facts">
                <DependencyFact
                  label={t('dependencies.lastChecked')}
                  actions={
                    <>
                      {!busy.has('check') && terminalOutcomes.check === 'cancelled' && (
                        <span className="dependency-terminal-outcome" role="status">{t('dependencies.checkCancelled')}</span>
                      )}
                      <button
                        type="button"
                        className="modal-btn"
                        disabled={anyBusy}
                        onClick={() => { void check() }}
                      >
                        {busy.has('check') ? t('dependencies.checking') : t('dependencies.checkForUpdates')}
                      </button>
                    </>
                  }
                >
                  <span className="dependency-fact-line">
                    {lastChecked ? i18n.dateTime(lastChecked) : t('dependencies.never')}
                  </span>
                  <label className="dependencies-toggle">
                    <input
                      type="checkbox"
                      checked={state.checkUpdatesAtLaunch}
                      disabled={busy.has('toggle') || busy.has('check')}
                      onChange={(e) => { void setCheckAtLaunch(e.target.checked) }}
                    />
                    {t('dependencies.checkAtLaunch')}
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
  const i18n = useI18n()
  const { t } = i18n
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
        {!required && <span className="dependency-optional">{t('dependencies.optional')}</span>}
        <span
          className={`dependency-badge dependency-badge-${info.state}${
            info.state === 'not-installed' && required ? ' dependency-badge-required' : ''
          }`}
        >
          {t(STATE_LABEL[info.state])}
        </span>
      </div>
      <p className="dependency-desc">{description}</p>
      <div className="dependency-facts">
        <DependencyFact
          label={t('dependencies.installed')}
          actions={
            actionLabel && (
              <>
                {!busy && terminalOutcome === 'cancelled' && (
                  <span className="dependency-terminal-outcome" role="status">{t('dependencies.cancelled')}</span>
                )}
                <button
                  type="button"
                  className={`modal-btn${emphasized ? ' modal-btn-primary' : ''}`}
                  disabled={disabled}
                  onClick={onAction}
                >
                  {busy ? t('dependencies.working') : t(actionLabel)}
                </button>
              </>
            )
          }
        >
          <span className="dependency-fact-line dependency-meta">{installedSummary(info, i18n)}</span>
          {busy && progress && (
            <div className="dependency-progress">
              <div
                className="dependency-progress-bar"
                role="progressbar"
                aria-label={t('dependencies.progressLabel', { title })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
              >
                <div
                  className="dependency-progress-fill"
                  style={pct === null ? { width: '100%', opacity: 0.4 } : { width: `${pct}%` }}
                />
              </div>
              <span className="dependency-progress-label">{progressLabel(progress, i18n)}</span>
            </div>
          )}
        </DependencyFact>
      </div>
    </section>
  )
}
