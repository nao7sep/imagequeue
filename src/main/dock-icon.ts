import { app } from 'electron'
import icon from '../../resources/icon.png?asset'
import { log, serializeError } from './logger'

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
      error: serializeError(err)
    })
  }
}

// Dismissing the fullscreen viewer makes macOS rebuild the Dock tile from the
// on-disk bundle (the Dock un-hides as kiosk mode exits), which drops our icon
// overlay. That rebuild is asynchronous and rides the un-hide animation, and
// there is NO event that fires once it settles — a single synchronous re-assert
// at close time provably loses the race (verified via logging: setIcon reports
// success, then the tile reverts). The repaint lands at a VARIABLE time, so a
// re-assert only sticks if it fires after that repaint.
//
// Four swings, spread across the window the repaint can land in:
//   0ms    — immediate, covers the case where the tile was never dropped.
//   300ms  — the common, fast repaint.
//   1000ms — a mid-range repaint.
//   3000ms — the late repaint; this is the swing that actually fixes the
//            intermittent misses. It is deliberately generous because the
//            repaint lands well past a second on some machines. The only cost
//            of a later final swing is cosmetic (the default icon may show that
//            much longer before snapping back); if it still occasionally
//            reverts, raise this value further — the earlier swings barely
//            matter for the repaint case.
// Best-effort and dev-only: app.dock.setIcon is idempotent, so overlapping
// schedules from rapid open/close are harmless, and every call is guarded by
// applyDevDockIcon's platform / packaged checks.
const DEV_DOCK_REASSERT_DELAYS_MS = [0, 300, 1000, 3000]

export function reassertDevDockIconAfterRepaint(): void {
  if (process.platform !== 'darwin' || app.isPackaged) return
  for (const delay of DEV_DOCK_REASSERT_DELAYS_MS) {
    setTimeout(applyDevDockIcon, delay)
  }
}
