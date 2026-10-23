import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_HARD_KILL_DELAY_MS, spawnOwnedCli, type OwnedCliProcess } from '../../../src/main/utils/owned-cli'

const guardianPath = fileURLToPath(new URL('../../../src/main/utils/owned-cli-guardian.cjs', import.meta.url))
const electronRoot = fileURLToPath(new URL('../../../node_modules/electron/', import.meta.url))
const electronPathFile = path.join(electronRoot, 'path.txt')
const installedElectron = fs.existsSync(electronPathFile)
  ? path.join(electronRoot, 'dist', fs.readFileSync(electronPathFile, 'utf8').trim())
  : ''
const cleanup: Array<() => void> = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })

function collect(proc: OwnedCliProcess): { result: Promise<{ code: number | null; signal: string | null }>; errors: Error[]; output: () => string; diagnostic: () => string } {
  const errors: Error[] = []
  let stdout = ''
  let stderr = ''
  proc.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  proc.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  proc.on('error', (error) => errors.push(error))
  const result = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    proc.on('close', (code, signal) => resolve({ code, signal }))
  })
  cleanup.push(() => { proc.kill('SIGKILL') })
  return { result, errors, output: () => stdout, diagnostic: () => stderr }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

describe('owned pipe CLI', () => {
  it('preserves literal arguments, removes Electron mode, and drains complete UTF-8 output before close', async () => {
    const text = '日本語 😀'.repeat(30_000)
    const proc = spawnOwnedCli(process.execPath, ['-e', `
      const bytes = Buffer.from('日本語 😀'.repeat(30000));
      process.stdout.write(bytes.subarray(0, 1)); process.stdout.write(bytes.subarray(1));
      process.stderr.write(bytes);
      process.stdout.write(JSON.stringify({ args: process.argv.slice(1), electron: process.env.ELECTRON_RUN_AS_NODE ?? null }));
    `, '--', 'spaces and $HOME', '"quoted";$(never)'])
    const observed = collect(proc)
    expect(await observed.result).toEqual({ code: 0, signal: null })
    expect(observed.errors).toEqual([])
    expect(observed.output()).toBe(text + JSON.stringify({ args: ['spaces and $HOME', '"quoted";$(never)'], electron: null }))
    expect(observed.diagnostic()).toBe(text)
    expect(proc.pid).toBeGreaterThan(0)
    expect(alive(proc.pid!)).toBe(false)
    expect(proc.kill()).toBe(false)
  })

  it.skipIf(!installedElectron || !fs.existsSync(installedElectron))('runs the production guardian boundary through installed Electron in Node mode', async () => {
    const source = fs.readFileSync(guardianPath, 'utf8')
    const text = '日本語 😀'.repeat(30_000)
    const guardian = spawn(installedElectron, ['-e', source, process.execPath, '-e', `
      const bytes = Buffer.from('日本語 😀'.repeat(30000));
      process.stdout.write(bytes.subarray(0, 1)); process.stdout.write(bytes.subarray(1));
      process.stderr.write(bytes);
      process.stdout.write(JSON.stringify({ electron: process.env.ELECTRON_RUN_AS_NODE ?? null, args: process.argv.slice(1) }));
    `, '--', '-literal-child-argument'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    cleanup.push(() => { guardian.kill('SIGTERM') })
    const messages: Array<{ type: string; pid?: number; code?: number; signal?: string | null }> = []
    guardian.on('message', (message) => messages.push(message as typeof messages[number]))
    let stdout = ''
    let stderr = ''
    guardian.stdout!.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    guardian.stderr!.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    expect(await once(guardian, 'close')).toEqual([0, null])
    expect(messages).toEqual([
      { type: 'started', pid: expect.any(Number) },
      { type: 'exit', code: 0, signal: null },
    ])
    expect(stdout).toBe(text + JSON.stringify({ electron: null, args: ['-literal-child-argument'] }))
    expect(stderr).toBe(text)
    expect(alive(messages[0]!.pid!)).toBe(false)
  })

  it('forwards a refused spawn as an error after guardian closure', async () => {
    const proc = spawnOwnedCli('/does-not-exist/imagequeue-cli', [])
    const observed = collect(proc)
    const ended = await observed.result
    expect(observed.errors).toHaveLength(1)
    expect(observed.errors[0]).toMatchObject({ code: 'ENOENT' })
    expect(ended.code).not.toBe(0)
    expect(proc.kill()).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('reports unexpected guardian loss without fabricating child success', async () => {
    const proc = spawnOwnedCli(process.execPath, ['-e', `
      process.stdout.write('child finished', () => process.kill(process.ppid, 'SIGKILL'));
    `])
    const observed = collect(proc)
    expect(await observed.result).toEqual({ code: null, signal: null })
    expect(observed.errors).toHaveLength(1)
    expect(observed.errors[0]!.message).toContain('CLI guardian ended before reporting child exit')
    expect(observed.output()).toBe('child finished')
  })

  it.skipIf(process.platform === 'win32')('keeps ownership until a SIGTERM-resistant child actually closes', async () => {
    const proc = spawnOwnedCli(process.execPath, ['-e', `
      process.on('SIGTERM', () => process.stdout.write('term ignored'));
      process.stdout.write('ready'); setInterval(() => {}, 20);
    `])
    const observed = collect(proc)
    await vi.waitFor(() => expect(observed.output()).toBe('ready'))
    let closed = false
    void observed.result.then(() => { closed = true })
    proc.kill('SIGTERM')
    await vi.waitFor(() => expect(observed.output()).toContain('term ignored'))
    expect(closed).toBe(false)
    const timer = setTimeout(() => proc.kill('SIGKILL'), CLI_HARD_KILL_DELAY_MS)
    expect(await observed.result).toEqual({ code: null, signal: 'SIGKILL' })
    clearTimeout(timer)
    expect(alive(proc.pid!)).toBe(false)
  })

  it.skipIf(process.platform === 'win32').each(['automatic escalation', 'explicit stop'])(
    'stops a surviving child after guardian death through %s and drains its output', async (mode) => {
      const proc = spawnOwnedCli(process.execPath, ['-e', `
        process.on('SIGTERM', () => {
          process.stdout.write('term ignored');
          process.stderr.write('still owned');
        });
        process.stdout.write(JSON.stringify({ guardian: process.ppid }));
        setInterval(() => {}, 20);
      `])
      const observed = collect(proc)
      await vi.waitFor(() => {
        expect(proc.pid).toBeGreaterThan(0)
        expect(observed.output()).toContain('}')
      })
      const guardianPid = (JSON.parse(observed.output()) as { guardian: number }).guardian
      let closed = false
      void observed.result.then(() => { closed = true })
      // This PID is the parent of the fixture child, not a process-name match.
      process.kill(guardianPid, 'SIGKILL')
      await vi.waitFor(() => expect(observed.output()).toContain('term ignored'))
      expect(closed).toBe(false)
      expect(alive(proc.pid!)).toBe(true)
      if (mode === 'explicit stop') expect(proc.kill('SIGKILL')).toBe(true)
      expect(await observed.result).toEqual({ code: null, signal: null })
      expect(observed.diagnostic()).toBe('still owned')
      expect(observed.errors).toHaveLength(1)
      expect(observed.errors[0]!.message).toContain('CLI guardian ended before reporting child exit')
      await vi.waitFor(() => expect(alive(proc.pid!)).toBe(false))
      expect(proc.kill()).toBe(false)
    },
  )

  it.skipIf(process.platform === 'win32')('retains a guardianless child after it closes both output pipes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-cli-pipes-'))
    cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
    const stateFile = path.join(root, 'state')
    const proc = spawnOwnedCli(process.execPath, ['-e', `
      const fs = require('node:fs');
      process.on('SIGTERM', () => fs.writeFileSync(process.argv[1], 'term ignored'));
      process.stdout.write(JSON.stringify({ guardian: process.ppid }), () => {
        fs.closeSync(1); fs.closeSync(2);
        fs.writeFileSync(process.argv[1], 'pipes closed');
      });
      setInterval(() => {}, 20);
    `, stateFile])
    const observed = collect(proc)
    await vi.waitFor(() => expect(fs.readFileSync(stateFile, 'utf8')).toBe('pipes closed'))
    await vi.waitFor(() => expect(proc.pid).toBeGreaterThan(0))
    let closed = false
    void observed.result.then(() => { closed = true })
    process.kill((JSON.parse(observed.output()) as { guardian: number }).guardian, 'SIGKILL')
    await vi.waitFor(() => expect(fs.readFileSync(stateFile, 'utf8')).toBe('term ignored'))
    expect(closed).toBe(false)
    expect(alive(proc.pid!)).toBe(true)
    expect(await observed.result).toEqual({ code: null, signal: null })
    expect(alive(proc.pid!)).toBe(false)
    expect(observed.errors).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('stops a live resistant child when its parent is killed, with no name lookup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-owned-cli-'))
    cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
    const heartbeat = path.join(root, 'heartbeat')
    const childScript = path.join(root, 'child.cjs')
    fs.writeFileSync(childScript, `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      fs.writeFileSync(process.argv[2], 'beat');
      setInterval(() => fs.appendFileSync(process.argv[2], 'beat'), 20);
    `)
    const parent = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const guardian = spawn(process.execPath, [${JSON.stringify(guardianPath)}, process.execPath, ${JSON.stringify(childScript)}, ${JSON.stringify(heartbeat)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      guardian.on('message', message => { if (message.type === 'started') process.stdout.write(String(message.pid)); });
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    cleanup.push(() => { parent.kill('SIGKILL') })
    let pidText = ''
    parent.stdout!.setEncoding('utf8').on('data', (chunk) => { pidText += chunk })
    await vi.waitFor(() => expect(Number(pidText)).toBeGreaterThan(0))
    const pid = Number(pidText)
    cleanup.push(() => { if (alive(pid)) process.kill(pid, 'SIGKILL') })
    await vi.waitFor(() => expect(fs.existsSync(heartbeat)).toBe(true))
    const first = fs.statSync(heartbeat).size
    await vi.waitFor(() => expect(fs.statSync(heartbeat).size).toBeGreaterThan(first))
    expect(alive(pid)).toBe(true)
    const parentClose = once(parent, 'close')
    parent.kill('SIGKILL')
    await parentClose
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3000 })
    const final = fs.statSync(heartbeat).size
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fs.statSync(heartbeat).size).toBe(final)
  })
})
