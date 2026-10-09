/** Terminate the process without waiting for a worker executing native code.
 * Only quit's deadline/explicit-abandon path may use this; a normal settled
 * shutdown goes through Electron's clean exit. Node maps SIGKILL to immediate
 * termination on Windows as well as POSIX. */
export function forceExit(): void {
  process.kill(process.pid, 'SIGKILL')
}
