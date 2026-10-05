import { app, dialog } from 'electron'

// Every mutable app store is process-owned. Letting a second ImageQueue process
// open the same root would turn otherwise-atomic file replacement into competing
// read/modify/write snapshots (most dangerously for api-keys.json). Electron's
// native instance authority closes that entire class of split-brain state; a
// second launch raises the existing window instead of starting another writer.
//
// The lock is decided before this process loads, registers or opens anything:
// the rest of the app is imported only once the lock is held. One that loses it
// has handed over to the running instance and ends by app.exit, not app.quit: a
// quit would run the before-quit shutdown, whose steps write to the stores,
// records, backups and state the running instance owns.
//
// The primary instance loads in the microtask after this module, before the
// ready event, so it can still register privileged schemes. `startup` settles
// once it has been started.
function start(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
    return Promise.resolve()
  }
  return import('./primary-instance').then(({ runPrimaryInstance }) => runPrimaryInstance()).catch((error: unknown) => {
    // Nothing is running yet to report through, so this is Electron's own
    // error box, as an uncaught exception at load would show.
    dialog.showErrorBox('ImageQueue', error instanceof Error ? error.stack ?? error.message : String(error))
    app.exit(1)
  })
}

export const startup = start()
