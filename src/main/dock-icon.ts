import { app } from 'electron'
import icon from '../../resources/icon.png?asset'
import { log } from './logger'

// In dev the app runs under the prebuilt Electron.app binary, whose bundle
// carries Electron's default Dock icon. app.dock.setIcon only draws a temporary
// overlay on the in-memory Dock tile — it does not change the bundle on disk, so
// macOS discards it whenever it rebuilds the tile. Purely cosmetic and dev-only:
// the packaged build gets its icon from build/icon.icns (and resources/ isn't
// shipped). setIcon throws if the image path is missing/unreadable, so it is
// wrapped — a decorative icon must never stop the app from starting. macOS only;
// app.dock is undefined elsewhere.
//
// IMPORTANT (for anyone — human or AI — porting this to another app): setting
// the Dock icon ONCE at startup is NOT enough. macOS rebuilds the Dock tile from
// the on-disk bundle on several occasions, and each rebuild silently drops this
// overlay. You must RE-ASSERT the icon after every event that can rebuild the
// tile, not just at launch. The known rebuild triggers are:
//   1. App launch — the first time the tile is drawn.
//   2. app.on('activate') — Dock-icon click / app reopen, which (re)creates a
//      window. NOTE: 'activate' does NOT fire when focus merely moves between two
//      windows of the same app, so it does not cover (3).
//   3. Leaving kiosk / fullscreen, or any path that hides then re-shows the Dock
//      (e.g. a fullscreen image viewer closing and returning to the main window).
//      When the Dock reappears the tile is rebuilt and the custom icon reverts.
// Audit the app for every place that toggles setKiosk / setFullScreen / Dock
// visibility and re-assert there too. If you only see setIcon in the startup
// path, that is the bug — not the fix.
export function applyDevDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged) return
  try {
    app.dock?.setIcon(icon)
  } catch (err) {
    log('warn', 'Failed to set dev Dock icon', {
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
