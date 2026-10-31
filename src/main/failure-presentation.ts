import type { BackendId } from '../shared/types'
import type { AppNotice } from '../shared/app-notice'
import { message, type Message } from '../shared/i18n/translate'
import { mainTranslator } from './i18n'
import { DrawThingsOutOfMemoryError, httpStatus, MissingApiKeyError, ProviderRefusalError, ProviderStatusError } from './provider-errors'
import { LaunchStopError } from './store-format'

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

/** A provider's own code or status, reduced to plain characters safe to show.
 *  The task keeps it whole; the row wraps it rather than cutting it. */
function plainLabel(value: string): string | null {
  const label = value.replace(/[^\p{L}\p{N} _-]/gu, '').trim()
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

  if (error instanceof DrawThingsOutOfMemoryError) {
    return error.width && error.height
      ? message('taskFailure.outOfMemory', { size: `${error.width}×${error.height}` })
      : message('taskFailure.outOfMemoryNoSize')
  }
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

/**
 * What the startup failure window says. A launch that stopped on refused files
 * names each one, says whether a newer version wrote it or it could not be read,
 * and what the user can do; every other failure keeps the general copy, and its
 * diagnostic stays in the log.
 */
export function startupFailurePresentation(error: unknown): Message {
  if (!(error instanceof LaunchStopError) || error.refused.length === 0) return message('startupFailure.message')
  const lines = error.refused.map((file) =>
    message(file.newer ? 'startupFailure.refusedNewer' : 'startupFailure.refusedUnreadable', { path: file.path }))
  const files = lines.reduce((first, next) => message('startupFailure.fileList', { first, next }))
  return message('startupFailure.refusedMessage', { files })
}

/** A store a newer ImageQueue wrote was left as it is, and what it holds is unavailable here. */
export function newerFilePresentation(path: string): AppNotice {
  return {
    title: message('notice.newerFileTitle'),
    message: message('notice.newerFileMessage', { path }),
  }
}

/** A file at `path` could not be read, so it was left unchanged and the operation stopped. */
export function unreadableFilePresentation(path: string): AppNotice {
  return {
    title: message('notice.unreadableFileTitle'),
    message: message('notice.unreadableFileMessage', { path }),
  }
}

/** records.sqlite3 at `path` could not be opened: it is untouched and Records is off for this launch. */
export function recordsOffPresentation(path: string): AppNotice {
  return {
    title: message('notice.recordsOffTitle'),
    message: message('notice.recordsOffMessage', { path }),
  }
}

/** backups.sqlite3 at `path` could not be opened: it is untouched and backups are off for this launch. */
export function backupsOffPresentation(path: string): AppNotice {
  return {
    title: message('notice.backupsOffTitle'),
    message: message('notice.backupsOffMessage', { path }),
  }
}

/** api-keys.json at `path` cannot be used: it was left unchanged, its keys are unavailable, and key saves are refused. */
export function apiKeysUnavailablePresentation(path: string): AppNotice {
  return {
    title: message('notice.apiKeysUnavailableTitle'),
    message: message('notice.apiKeysUnavailableMessage', { path }),
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
