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

/** Maps internal recovery records to safe app-notice copy; paths and diagnostics remain in the log. */
export function elaboratorRecoveryPresentation(recovery: ElaboratorRecovery): AppNotice {
  if (recovery.kind === 'recovered') {
    return {
      title: 'Elaborator settings were reset',
      message: 'Your elaborator settings file was unreadable, so ImageQueue preserved it and restored ' +
        'the shipped defaults. Your edited templates remain in the preserved copy; check the ' +
        'session log for its location.',
    }
  }
  if (recovery.kind === 'quarantine-failed') {
    return {
      title: 'Elaborator settings could not be read',
      message: 'ImageQueue left the unreadable settings file in place because it could not set it aside. ' +
        'No replacement file was written. Check the session log, correct the data-folder problem, then try again.',
    }
  }
  return {
    title: 'Elaborator defaults could not be restored',
    message: 'ImageQueue preserved the unreadable elaborator settings, but could not write replacement defaults. ' +
      'Check the session log, correct the data-folder problem, then try again.',
  }
}
