export const STARTUP_FAILURE_TITLE = 'ImageQueue could not start'
export const STARTUP_FAILURE_MEASUREMENT_CHANNEL = 'startup-failure:measurement'

export const STARTUP_FAILURE_MESSAGE =
  'ImageQueue stopped before opening its main window. Its data was left unchanged. ' +
  'Check the session log, correct the startup problem, then start it again.'

export interface StartupFailureMeasurement {
  naturalHeight: number
  minimumHeight: number
}

export function isStartupFailureMeasurement(value: unknown): value is StartupFailureMeasurement {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<StartupFailureMeasurement>
  return Number.isFinite(candidate.naturalHeight) && Number(candidate.naturalHeight) > 0 &&
    Number.isFinite(candidate.minimumHeight) && Number(candidate.minimumHeight) > 0
}

export function fitStartupFailureHeight(
  measurement: StartupFailureMeasurement,
  workAreaHeight: number,
): { height: number; minimumHeight: number } {
  const cap = Math.max(1, Math.floor(workAreaHeight * 0.85))
  const minimumHeight = Math.min(cap, Math.max(1, Math.ceil(measurement.minimumHeight)))
  return {
    height: Math.min(cap, Math.max(minimumHeight, Math.ceil(measurement.naturalHeight))),
    minimumHeight,
  }
}
