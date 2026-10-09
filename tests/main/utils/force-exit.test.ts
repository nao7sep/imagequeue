import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('the deadline exit terminates a process with a worker still executing an uninterruptible native call', async () => {
  const module = new URL('../../../src/main/utils/force-exit.ts', import.meta.url)
  // A synchronous native crypto call cannot observe Worker.terminate until it
  // returns. The child is killed within milliseconds; the expensive call is
  // deliberately never allowed to finish. No mocked promise stands in for it.
  const source = `
    const { Worker } = require('node:worker_threads');
    const worker = new Worker("const { parentPort } = require('node:worker_threads'); const { pbkdf2Sync } = require('node:crypto'); parentPort.postMessage('entering'); pbkdf2Sync('test', 'test', 2147483647, 32, 'sha256')", { eval: true });
    worker.once('message', async () => {
      const { forceExit } = await import(${JSON.stringify(module.href)});
      setTimeout(() => {
        let terminated = false;
        void worker.terminate().then(() => { terminated = true; });
        setTimeout(() => {
          if (terminated) { process.exit(42); return; }
          require('node:fs').writeSync(1, 'native-still-running\\n');
          forceExit();
        }, 25);
      }, 25);
    });
  `
  // Resolve this test's own subject as a real file, not a bundler inlined copy.
  expect(fileURLToPath(module)).toMatch(/force-exit\.ts$/)
  const child = spawn(process.execPath, ['-e', source], { stdio: 'pipe' })
  let errors = ''
  let output = ''
  child.stdout.on('data', (data) => { output += String(data) })
  child.stderr.on('data', (data) => { errors += String(data) })
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, signal: null, timedOut: true }) }, 2_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut: false }) })
  })
  expect(errors).not.toContain('Error')
  expect(result.timedOut).toBe(false)
  expect(output).toContain('native-still-running')
  if (process.platform !== 'win32') expect(result.signal).toBe('SIGKILL')
  else expect(result.code).not.toBe(0)
})
