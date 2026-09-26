import type { BackendId } from '../shared/types'
import type { AppNotice } from '../shared/app-notice'
import { message, type Message } from '../shared/i18n/translate'
import { mainTranslator } from './i18n'
import { httpStatus, MissingApiKeyError, ProviderRefusalError, ProviderStatusError } from './provider-errors'

const BACKEND_NAMES: Record<BackendId, string> = {
  openai: 'OpenAI',
  nanobanana: 'Nano Banana',
  grok: 'Grok',
  flux: 'FLUX',
  drawthings: 'Draw Things',
}

function structuredString(error: unknown, field: 'code' | 'name'): string | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

/** A provider's own code or status, reduced to a short plain label safe to show. */
function plainLabel(value: string): string | null {
  const label = value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40)
  return label || null
}

/**
 * Maps generation diagnostics to stable task copy without exposing provider,
 * IPC, or filesystem detail. The task keeps the message, not its words, so the
 * row reads in whatever language is current.
 */
export function generationFailurePresentation(backend: BackendId, error: unknown, generated: boolean): Message {
  if (generated) {
    return message('taskFailure.notSaved')
  }

  const name = BACKEND_NAMES[backend]
  const status = httpStatus(error)
  const code = structuredString(error, 'code')
  const errorName = structuredString(error, 'name')

  if (error instanceof MissingApiKeyError) {
    return message('taskFailure.missingKey', { name })
  }
  if (error instanceof ProviderRefusalError) {
    const reason = plainLabel(error.reason)
    return reason
      ? message('taskFailure.refusedWithReason', { name, reason })
      : message('taskFailure.refused', { name })
  }
  const providerStatus = error instanceof ProviderStatusError ? plainLabel(error.providerStatus) : null
  if (providerStatus) {
    return message('taskFailure.providerStatus', { name, status: providerStatus })
  }
  if (status === 401 || status === 403) {
    return message('taskFailure.credentials', { name })
  }
  if (status === 429) {
    return message('taskFailure.rateLimited', { name })
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || errorName === 'TimeoutError') {
    return message('taskFailure.timedOut', { name })
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return message('taskFailure.fileAccess')
  }
  return message('taskFailure.generic', { name })
}

/** The session file could not be written while the queue ran, so the queue paused. */
export function queueStorageFailurePresentation(): AppNotice {
  return {
    title: message('notice.queuePausedTitle'),
    message: message('notice.queuePausedMessage'),
  }
}

type ElaboratorRecovery = {
  kind: 'recovered' | 'quarantine-failed' | 'reseed-failed'
  path?: string
  error?: string
}

/** Only successful recovery is app-wide. Failed recovery rejects to the active modal, its sole owner. */
export function elaboratorRecoveryPresentation(recovery: ElaboratorRecovery): AppNotice | null {
  if (recovery.kind !== 'recovered') return null
  return {
    title: message('notice.elaboratorsResetTitle'),
    message: message('notice.elaboratorsResetMessage'),
  }
}

/**
 * Stable terminal copy for an app-owned spawn failure; the original error
 * remains in the log. It joins the CLI's own output lines, so it is written in
 * the language current when the job failed.
 */
export function cliJobStartFailurePresentation(
  kind: 'import' | 'download',
  _error: unknown,
): string {
  return mainTranslator().t(kind === 'import' ? 'cliJob.importStartFailed' : 'cliJob.downloadStartFailed')
}
