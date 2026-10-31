import { handle } from './ipc-boundary'
import { takePendingAppNotices } from './app-notices'
import type { AppNotice } from '../shared/app-notice'

// Notices raised before any window could listen. The window takes them once it
// is subscribed to app notices, and each is handed out once.
export function registerAppNoticeIpc(): void {
  handle('app:takePendingNotices', (): AppNotice[] => takePendingAppNotices())
}
