import { STARTUP_FAILURE_MESSAGE } from '../shared/startup-failure'

/** Truthful guidance shared by every synchronous main-process startup failure. */
export function startupFailureMessage(error: unknown): string {
  void error
  return STARTUP_FAILURE_MESSAGE
}
