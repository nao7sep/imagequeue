import { serializeError } from '../../../shared/serialize-error'

export const OPERATIONAL_FAILURE_EVENT = 'imagequeue-operational-failure'

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

/** Routes background/action failures to the persistent app-shell result owner. */
export function reportOperationalFailure(
  key: string,
  userMessage: string,
  diagnosticMessage: string,
  error: unknown,
): void {
  window.dispatchEvent(new CustomEvent(OPERATIONAL_FAILURE_EVENT, { detail: { key, message: userMessage } }))
  recordOperationalDiagnostic(diagnosticMessage, error)
}
