export const STARTUP_FAILURE_TITLE = 'ImageQueue could not start'

export const STARTUP_FAILURE_MESSAGE =
  'ImageQueue stopped before opening its main window. Its data was left unchanged. ' +
  'Check the session log, correct the startup problem, then start it again.'

export interface StartupFailureMeasurement {
  naturalHeight: number
  minimumHeight: number
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
