import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

type Ended = { code: number | null; signal: NodeJS.Signals | null }

async function endWithBusyWorker(): Promise<Ended> {
  const module = new URL('../../../src/main/utils/force-exit.ts', import.meta.url)
  // A synchronous native crypto call cannot observe Worker.terminate until it
  // returns. The child is killed at once; the expensive call is
  // deliberately never allowed to finish. No mocked promise stands in for it.
  const source = `
    const { Worker } = require('node:worker_threads');
    const worker = new Worker("const { parentPort } = require('node:worker_threads'); const { pbkdf2Sync } = require('node:crypto'); parentPort.postMessage('entering'); pbkdf2Sync('test', 'test', 2147483647, 32, 'sha256')", { eval: true });
    worker.once('message', async () => {
      const { forceExit } = await import(${JSON.stringify(module.href)});
      setImmediate(() => {
        let terminated = false;
        void worker.terminate().then(() => { terminated = true; });
        setImmediate(() => {
          if (terminated) { process.exit(42); return; }
          require('node:fs').writeSync(1, 'native-still-running\\n');
          forceExit();
        });
      });
    });
  `
  // Resolve this test's own subject as a real file, not a bundler inlined copy.
  expect(fileURLToPath(module)).toMatch(/force-exit\.ts$/)
  const child = spawn(process.execPath, ['-e', source], { stdio: 'pipe' })
  let errors = ''
  let output = ''
  child.stdout.on('data', (data) => { output += String(data) })
  child.stderr.on('data', (data) => { errors += String(data) })
  const result = await new Promise<Ended>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  expect(errors).not.toContain('Error')
  expect(output).toContain('native-still-running')
  return result
}

const isWindows = process.platform === 'win32'

it.skipIf(isWindows)('the deadline exit kills a process whose worker is in an uninterruptible native call (POSIX)', async () => {
  expect((await endWithBusyWorker()).signal).toBe('SIGKILL')
})

// Node maps SIGKILL to TerminateProcess; only a Windows host shows its exit.
it.runIf(isWindows)('the deadline exit terminates a process whose worker is in an uninterruptible native call (Windows)', async () => {
  expect((await endWithBusyWorker()).code).not.toBe(0)
})
