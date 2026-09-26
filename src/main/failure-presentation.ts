import type { BackendId } from '../shared/types'
import type { AppNotice } from '../shared/app-notice'
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

/** Maps generation diagnostics to stable task copy without exposing provider, IPC, or filesystem detail. */
export function generationFailurePresentation(backend: BackendId, error: unknown, generated: boolean): string {
  if (generated) {
    return 'The image was generated, but ImageQueue could not save it. Check that the output location is available and has enough free space, then retry.'
  }

  const name = BACKEND_NAMES[backend]
  const status = httpStatus(error)
  const code = structuredString(error, 'code')
  const errorName = structuredString(error, 'name')

  if (error instanceof MissingApiKeyError) {
    return `No ${name} API key is set. Add it in Settings, then retry.`
  }
  if (error instanceof ProviderRefusalError) {
    const reason = plainLabel(error.reason)
    return `${name} refused this prompt${reason ? ` (\u201c${reason}\u201d)` : ''}. ` +
      'Change the prompt, then retry.'
  }
  const providerStatus = error instanceof ProviderStatusError ? plainLabel(error.providerStatus) : null
  if (providerStatus) {
    return `${name} ended this request without an image and reported \u201c${providerStatus}\u201d. ` +
      'Retry it; if the same status returns, change the prompt.'
  }
  if (status === 401 || status === 403) {
    return `${name} rejected the configured credentials. Check the API key in Settings, then retry.`
  }
  if (status === 429) {
    return `${name} is rate-limiting requests. Wait a moment, then retry.`
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || errorName === 'TimeoutError') {
    return `${name} did not respond in time. Check the connection, then retry.`
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'ImageQueue could not access a required local file. Check the app’s file permissions, then retry.'
  }
  return `${name} could not generate this image. Retry it; if the problem continues, check the session log.`
}

/** The session file could not be written while the queue ran, so the queue paused. */
export function queueStorageFailurePresentation(): AppNotice {
  return {
    title: 'Queue paused',
    message: 'ImageQueue could not save this session\u2019s progress, so it paused the queue ' +
      'before starting anything else. Images already generating will finish. Check that the ' +
      'output location is available and has enough free space, then choose Resume.',
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
    title: 'Elaborator settings were reset',
    message: 'Your elaborator settings file was unreadable, so ImageQueue preserved it and restored ' +
      'the shipped defaults. Your edited templates remain in the preserved copy; check the ' +
      'session log for its location.',
  }
}

/** Stable terminal copy for an app-owned spawn failure; the original error remains in the log. */
export function cliJobStartFailurePresentation(
  kind: 'import' | 'download',
  _error: unknown,
): string {
  return kind === 'import'
    ? 'The model import could not be started. Check the session log for details.'
    : 'The model download could not be started. Check the session log for details.'
}
