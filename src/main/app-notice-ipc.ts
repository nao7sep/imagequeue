import { handle } from './ipc-boundary'
import { drainSetAsideConfigPaths } from './config/config-store'
import { configResetPresentation } from './failure-presentation'
import type { AppNotice } from '../shared/app-notice'

// Notices raised before any window could listen. The window takes them once it
// is subscribed to app notices, and each is handed out once.
export function registerAppNoticeIpc(): void {
  handle('app:takePendingNotices', (): AppNotice[] => drainSetAsideConfigPaths().map(configResetPresentation))
}
