import { setQueuePaused } from '../backends/cancellation'
import { queueStorageFailurePresentation } from '../failure-presentation'
import { log, serializeError } from '../logger'
import { publishAppNotice, publishQueueState } from './publisher'

let reported = false

/** A resumed scheduling period may report a fresh storage failure. */
export function resetStorageFailureNotice(): void { reported = false }

/** Memory is still authoritative after an applied change's save fails. Expose
 * that actual state, retain the session owner's required save for retry/quit,
 * and stop admitting paid work until the user resumes. User Pause does not
 * imply this consequence was reported. */
export function pauseForStorageFailure(phase: 'start' | 'finish' | 'change', error: unknown): void {
  log('error', 'Session manifest could not be saved; queue paused', { phase, error: serializeError(error) })
  setQueuePaused(true)
  if (!reported) {
    reported = true
    publishAppNotice(queueStorageFailurePresentation())
  }
  publishQueueState()
}
