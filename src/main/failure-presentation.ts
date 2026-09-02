import type { BackendId } from '../shared/types'
import type { AppNotice } from '../shared/app-notice'

const BACKEND_NAMES: Record<BackendId, string> = {
  openai: 'OpenAI',
  nanobanana: 'Nano Banana',
  grok: 'Grok',
  flux: 'FLUX',
  drawthings: 'Draw Things',
}

function structuredNumber(error: unknown, field: 'status' | 'statusCode'): number | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'number' ? value : null
}

function structuredString(error: unknown, field: 'code' | 'name'): string | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

/** Maps generation diagnostics to stable task copy without exposing provider, IPC, or filesystem detail. */
export function generationFailurePresentation(backend: BackendId, error: unknown, generated: boolean): string {
  if (generated) {
    return 'The image was generated, but ImageQueue could not save it. Check that the output location is available and has enough free space, then retry.'
  }

  const name = BACKEND_NAMES[backend]
  const status = structuredNumber(error, 'status') ?? structuredNumber(error, 'statusCode')
  const code = structuredString(error, 'code')
  const errorName = structuredString(error, 'name')

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
