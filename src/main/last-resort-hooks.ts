import { app } from 'electron'
import { log, serializeError } from './logger'
import { maskDiagnostic } from './records'

export function installLastResortHooks(): void {
  // Before Records opens, the console is the diagnostic backstop. Fatal
  // errors exit; unhandled rejections retain the existing continue policy.
  process.on('uncaughtException', (error) => {
    const diagnostic = maskDiagnostic(serializeError(error))
    log('error', 'Uncaught exception', { error: diagnostic })
    console.error('Uncaught exception:', diagnostic)
    // Crash handling cannot safely resume writes; the OS reclaims resources.
    app.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    const diagnostic = maskDiagnostic(serializeError(reason))
    log('error', 'Unhandled rejection', { error: diagnostic })
    console.error('Unhandled rejection:', diagnostic)
  })
}
