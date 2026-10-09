import type { BackendId } from '../shared/types'
import type { AppNotice } from '../shared/app-notice'
import type { ElaboratorRecoveryNotice } from './elaborators'
import { message, type Message } from '../shared/i18n/translate'
import { mainTranslator } from './i18n'
import { httpStatus, MissingApiKeyError, ProviderRefusalError, ProviderStatusError } from './provider-errors'
import { ConfigFileHaltError } from './config/config-store'
import { NewerFormatError } from './store-format'

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

/** Only successful recovery is app-wide. Failed recovery rejects to the active modal, its sole owner. */
export function elaboratorRecoveryPresentation(recovery: ElaboratorRecoveryNotice): AppNotice | null {
  if (recovery.kind !== 'recovered') return null
  return {
    title: message('notice.elaboratorsResetTitle'),
    message: message('notice.elaboratorsResetMessage', { path: recovery.path }),
  }
}

/** config.json was unreadable and set aside at `path`; the app started from built-in settings. */
/**
 * What the startup failure window says. A settings file that could not be used,
 * or a file a newer ImageQueue wrote, is named with its path, since the user
 * repairs, moves or reopens it; every other failure keeps the general copy, and
 * its diagnostic stays in the log.
 */
export function startupFailurePresentation(error: unknown): Message {
  if (error instanceof ConfigFileHaltError) return message('startupFailure.settingsFileMessage', { path: error.path })
  if (error instanceof NewerFormatError) return message('startupFailure.newerFileMessage', { path: error.path })
  return message('startupFailure.message')
}

/** A store a newer ImageQueue wrote was left as it is, and what it holds is unavailable here. */
export function newerFilePresentation(path: string): AppNotice {
  return {
    title: message('notice.newerFileTitle'),
    message: message('notice.newerFileMessage', { path }),
  }
}

/** A store could be neither read nor set aside, so it was left at `path` and the operation stopped. */
export function storeLeftInPlacePresentation(path: string): AppNotice {
  return {
    title: message('notice.fileLeftInPlaceTitle'),
    message: message('notice.fileLeftInPlaceMessage', { path }),
  }
}

/** api-keys.json at `path` cannot be used: it was left unchanged, its keys are unavailable, and key saves are refused. */
export function apiKeysUnavailablePresentation(path: string): AppNotice {
  return {
    title: message('notice.apiKeysUnavailableTitle'),
    message: message('notice.apiKeysUnavailableMessage', { path }),
  }
}

/** params.json was unreadable and set aside at `path`; each model uses its recommended or default parameters. */
export function modelParamsResetPresentation(path: string): AppNotice {
  return {
    title: message('notice.drawThingsParamsResetTitle'),
    message: message('notice.drawThingsParamsResetMessage', { path }),
  }
}

/** concepts.sqlite3 was unreadable and set aside at `path`; a new, empty concept library started. */
export function conceptLibraryResetPresentation(path: string): AppNotice {
  return {
    title: message('notice.conceptLibraryResetTitle'),
    message: message('notice.conceptLibraryResetMessage', { path }),
  }
}

export function configResetPresentation(path: string): AppNotice {
  return {
    title: message('notice.settingsResetTitle'),
    message: message('notice.settingsResetMessage', { path }),
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
