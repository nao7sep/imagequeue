import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import guardianSource from './owned-cli-guardian.cjs?raw'

export const CLI_HARD_KILL_DELAY_MS = 500

export interface OwnedCliProcess extends EventEmitter {
  stdout: Readable
  stderr: Readable
  pid: number | undefined
  kill(signal?: string): boolean
}

type GuardianMessage =
  | { type: 'started'; pid: number }
  | { type: 'error'; message: string; code?: string }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }

/** Pipe children need an IPC guardian: ordinary pipes do not die with Electron. */
export function spawnOwnedCli(command: string, args: string[]): OwnedCliProcess {
  const guardian = spawn(process.execPath, ['-e', guardianSource, command, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  })
  let childExit: Extract<GuardianMessage, { type: 'exit' }> | undefined
  let failure: Error | undefined
  let closed = false
  const proc: OwnedCliProcess = Object.assign(new EventEmitter(), {
    stdout: guardian.stdout!,
    stderr: guardian.stderr!,
    pid: undefined as number | undefined,
    kill(signal = 'SIGTERM'): boolean {
      if (closed || !guardian.connected || (signal !== 'SIGTERM' && signal !== 'SIGKILL')) return false
      guardian.send({ signal }, (error) => {
        // A closing IPC channel is normal. Unexpected guardian loss is reported
        // after close, when its inherited output pipes have also drained.
        if (error && !closed) failure ??= error
      })
      return true
    }
  })
  guardian.on('message', (raw) => {
    const message = raw as GuardianMessage
    if (message.type === 'started') proc.pid = message.pid
    else if (message.type === 'error') failure = Object.assign(new Error(message.message), { code: message.code })
    else if (message.type === 'exit') childExit = message
  })
  guardian.on('error', (error) => { failure = error })
  guardian.on('close', (code, signal) => {
    closed = true
    if (!childExit) failure ??= new Error(`CLI guardian ended before reporting child exit (code ${code}, signal ${signal})`)
    if (failure) proc.emit('error', failure)
    // An unknown child outcome is never converted to a successful exit.
    proc.emit('close', childExit?.code ?? null, childExit?.signal ?? null)
  })
  return proc
}
