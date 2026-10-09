import { broadcastPresentation } from './presentation'
import type { AppNotice } from '../shared/app-notice'

// Notices main raises with no renderer request waiting on them. Until a window
// has taken the pending ones, they wait here; from then on they go to every
// window as they are raised.
const pending: AppNotice[] = []
let windowsListening = false

export function raiseAppNotice(notice: AppNotice): void {
  if (windowsListening) broadcastPresentation('app:notice', notice)
  else pending.push(notice)
}

export function takePendingAppNotices(): AppNotice[] {
  windowsListening = true
  return pending.splice(0)
}
