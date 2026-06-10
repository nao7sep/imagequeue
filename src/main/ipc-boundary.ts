import { ipcMain } from 'electron'
import { log, serializeError } from './logger'

// The one place renderer→main invoke handlers are registered. Every registrar
// goes through handle() instead of ipcMain.handle directly, so a throw is
// logged at the main boundary — with the channel and full error fidelity
// (type/message/stack/cause via serializeError) — before it rejects the
// renderer's promise. Without this the failure crosses back to the renderer
// silently and the session log, the record we debug from, never sees the IPC
// boundary it failed at: exactly the gap the logging convention's "error
// handling at every boundary" rule closes.
//
// The handler still rethrows after logging, so the renderer promise rejects
// exactly as before and renderer-side error handling is unchanged. Expected
// control-flow failures a handler chooses to swallow itself (e.g. an invalid
// URL it simply ignores and returns) never propagate out, so they stay
// unlogged here, as the convention intends.
//
// Wrapping the listener in async unifies sync and promise-returning handlers: a
// synchronous throw and an async rejection both land in the same catch. It adds
// no observable behavior — ipcMain.handle already resolves the listener's
// return through Promise.resolve.
//
// `...args: any[]` mirrors Electron's own ipcMain.handle signature, so every
// handler's specific argument tuple (id: string, patch: {...}, …) is accepted
// at the call site while still being fully type-checked inside each handler
// body. A stricter unknown[] would reject those concrete parameter types.
type IpcInvokeHandler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown

export function handle(channel: string, fn: IpcInvokeHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args)
    } catch (err) {
      log('error', 'IPC handler failed', { channel, error: serializeError(err) })
      throw err
    }
  })
}
