import { serializeError } from '../../../shared/serialize-error'
import type { MessageKey } from '../../../shared/i18n/catalogues'

export const OPERATIONAL_FAILURE_EVENT = 'imagequeue-operational-failure'
export const OPERATIONAL_RESOLVED_EVENT = 'imagequeue-operational-resolved'

export interface OperationalFailureDetail { key: string; message: MessageKey }
export interface OperationalResolvedDetail { key: string }

export function recordOperationalDiagnostic(
  diagnosticMessage: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  try {
    const logging = window.electronAPI.appLog?.('error', diagnosticMessage, {
      ...context,
      error: serializeError(error),
    })
    void logging?.catch((logError) => console.error('Failed to record an operational diagnostic', logError))
  } catch (logError) {
    console.error('Failed to record an operational diagnostic', logError)
  }
}

/**
 * Routes a background or action failure to the app's toast stack. The key names
 * the operation: a repeat of the same key replaces the toast already shown
 * and moves it to the newest position, and the toast stays until the user
 * closes it or
 * `clearOperationalFailure` reports that the same operation later succeeded.
 */
export function reportOperationalFailure(
  key: string,
  userMessage: MessageKey,
  diagnosticMessage: string,
  error: unknown,
): void {
  window.dispatchEvent(new CustomEvent<OperationalFailureDetail>(OPERATIONAL_FAILURE_EVENT, { detail: { key, message: userMessage } }))
  recordOperationalDiagnostic(diagnosticMessage, error)
}

/**
 * A later success of the same operation supersedes its failure. Only an
 * operation whose success proves the earlier problem is gone calls this: a
 * saved preference, a refreshed state, an updated viewer, a completed command.
 */
export function clearOperationalFailure(key: string): void {
  window.dispatchEvent(new CustomEvent<OperationalResolvedDetail>(OPERATIONAL_RESOLVED_EVENT, { detail: { key } }))
}

