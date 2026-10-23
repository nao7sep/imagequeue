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
  let guardianLost = false
  let hardKillTimer: ReturnType<typeof setTimeout> | undefined

  function signalRecordedChild(signal: 'SIGTERM' | 'SIGKILL'): boolean {
    if (closed || childExit || proc.pid === undefined) return false
    try {
      return process.kill(proc.pid, signal)
    } catch (error) {
      // The child can exit before its guardian reports it. Never find a
      // replacement by executable or command line when the recorded PID is gone.
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        failure = new AggregateError([failure, error].filter(Boolean), 'CLI guardian fallback could not signal its child')
      }
      return false
    }
  }

  function stopWithoutGuardian(): void {
    if (closed || childExit || hardKillTimer || proc.pid === undefined) return
    if (!signalRecordedChild('SIGTERM')) return
    hardKillTimer = setTimeout(() => signalRecordedChild('SIGKILL'), CLI_HARD_KILL_DELAY_MS)
  }

  function loseGuardian(error: Error): void {
    if (closed || childExit) return
    failure ??= error
    guardianLost = true
    stopWithoutGuardian()
  }

  const proc: OwnedCliProcess = Object.assign(new EventEmitter(), {
    stdout: guardian.stdout!,
    stderr: guardian.stderr!,
    pid: undefined as number | undefined,
    kill(signal = 'SIGTERM'): boolean {
      if (closed || childExit || (signal !== 'SIGTERM' && signal !== 'SIGKILL')) return false
      if (guardianLost || !guardian.connected) {
        loseGuardian(new Error('CLI guardian disconnected before reporting child exit'))
        return signalRecordedChild(signal)
      }
      guardian.send({ signal }, (error) => {
        if (error) loseGuardian(error)
      })
      return true
    }
  })
  guardian.on('message', (raw) => {
    const message = raw as GuardianMessage
    if (message.type === 'started') {
      proc.pid = message.pid
      if (guardianLost) stopWithoutGuardian()
    }
    else if (message.type === 'error') failure = Object.assign(new Error(message.message), { code: message.code })
    else if (message.type === 'exit') {
      childExit = message
      clearTimeout(hardKillTimer)
    }
  })
  guardian.on('error', (error) => { failure = error })
  // 'close' waits for inherited pipes: a surviving child can keep them open
  // forever. Start fallback teardown at loss of the control channel/process.
  guardian.on('disconnect', () => loseGuardian(new Error('CLI guardian ended before reporting child exit (IPC disconnected)')))
  guardian.on('exit', (code, signal) => loseGuardian(new Error(`CLI guardian ended before reporting child exit (code ${code}, signal ${signal})`)))
  guardian.on('close', (code, signal) => {
    if (!childExit) failure ??= new Error(`CLI guardian ended before reporting child exit (code ${code}, signal ${signal})`)
    const settle = (): void => {
      // A child can close its inherited pipes before exiting. With no guardian
      // left to reap/report it, keep the reservation until that recorded PID is
      // gone; pipe closure alone must not release capacity or cancel escalation.
      if (guardianLost && !childExit && proc.pid !== undefined) {
        try {
          process.kill(proc.pid, 0)
          setTimeout(settle, 20)
          return
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            setTimeout(settle, 20)
            return
          }
        }
      }
      closed = true
      clearTimeout(hardKillTimer)
      if (failure) proc.emit('error', failure)
      // An unknown child outcome is never converted to a successful exit.
      proc.emit('close', childExit?.code ?? null, childExit?.signal ?? null)
    }
    settle()
  })
  return proc
}
