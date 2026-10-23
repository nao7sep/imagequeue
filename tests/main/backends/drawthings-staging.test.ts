import { toDrawThingsTaskParams } from '../../../src/shared/draw-things-params'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Draw Things is the ONE backend where an external process owns the output file:
// the CLI writes it, the app reads it in and deletes it. That file must be staged
// in the app's temp directory, never the session directory — if the app dies
// between spawn and read, the CLI finishes writing into a folder nobody is
// watching, and in the session folder that left a permanent `drawthings-<id>.png`
// the app never handled. In temp it is swept by clearTempDir at the next launch.

const spawnCalls: { args: string[] }[] = []
const killSignals: string[] = []
let hangUntilKilled = false
let splitUtf8Output = false
let ignoreTerm = false
// How the fake CLI ends after writing its (possibly partial) output.
let exit: { code: number | null; signal: string | null; stderr: string } = { code: 0, signal: null, stderr: '' }

vi.mock('../../../src/main/utils/owned-cli', () => ({
  CLI_HARD_KILL_DELAY_MS: 500,
  spawnOwnedCli: (_cmd: string, args: string[]) => makeProc(args),
}))

// The generation timeout is read from config, which caches per process — the
// mock gives each test its own knob.
const configKnobs = vi.hoisted(() => ({ timeoutMs: 60_000, seed: null as number | null }))
vi.mock('../../../src/main/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadConfig: () => ({
    image_backends: {
      drawthings: {
        timeout_ms: configKnobs.timeoutMs,
        models_dir: '',
        default_params: {
          fallback_width: 1024, fallback_height: 1024, fallback_steps: 4,
          fallback_guidance: 1, fallback_negative_prompt: '', seed: configKnobs.seed,
        },
      },
    },
  }),
}))

function makeProc(args: string[]): EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: (sig?: string) => void } {
  spawnCalls.push({ args })
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: (sig?: string) => {
      killSignals.push(sig ?? 'SIGTERM')
      if (ignoreTerm && sig === 'SIGTERM') return
      setTimeout(() => proc.emit('close', null, sig ?? 'SIGTERM'), 0)
    },
  })
  if (spawnFails) {
    setTimeout(() => {
      proc.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
      proc.emit('close', null, null)
    }, 0)
    return proc
  }
  if (hangUntilKilled) {
    // A run that has started writing its image when it is stopped.
    const outPath = args[args.indexOf('--output') + 1]
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, Buffer.from([0x89, 0x50]))
  }
  if (!hangUntilKilled) {
    // Write the file the CLI would produce, then report success.
    const outIndex = args.indexOf('--output')
    const outPath = args[outIndex + 1]
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    // A real CLI that prints more than a pipe holds blocks until the pipe is
    // read, so the fake exits only once someone reads its stdout.
    setTimeout(() => {
      if (proc.stdout.listenerCount('data') === 0) return
      if (splitUtf8Output) {
        const bytes = Buffer.from('日本語 😀')
        for (const byte of bytes) {
          proc.stdout.write(Buffer.from([byte]))
          proc.stderr.write(Buffer.from([byte]))
        }
      } else {
        proc.stdout.write(Buffer.from('step 1/4\n'.repeat(20_000)))
        if (exit.stderr) proc.stderr.write(Buffer.from(exit.stderr))
      }
      proc.stdout.end()
      proc.stderr.end()
      proc.emit('close', exit.code, exit.signal)
    }, 0)
  }
  return proc
}

// What the AI-call record receives, so Records' copy of a failure can be checked.
const recorded = vi.hoisted(() => ({ failures: [] as Array<{ error: unknown; answer: unknown }>, finished: [] as unknown[] }))
vi.mock('../../../src/main/records', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startAiCall: () => ({
    fail: (error: unknown, answer?: unknown) => { recorded.failures.push({ error, answer }) },
    finish: (answer: unknown) => { recorded.finished.push(answer) },
  }),
}))
// A spawn the OS refuses, as when the CLI binary is missing.
let spawnFails = false

vi.mock('../../../src/main/local-cli', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCliPath: () => '/fake/draw-things-cli',
  resolveModelsDir: () => '/fake/models',
}))

const ENV_VAR = 'IMAGEQUEUE_DATA_DIR'

describe('Draw Things output staging', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    spawnCalls.length = 0
    killSignals.length = 0
    hangUntilKilled = false
    splitUtf8Output = false
    ignoreTerm = false
    exit = { code: 0, signal: null, stderr: '' }
    spawnFails = false
    recorded.failures.length = 0
    recorded.finished.length = 0
    configKnobs.timeoutMs = 60_000
    configKnobs.seed = null
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-dt-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    vi.resetModules()
  })

  it.each(['', '42'])('keeps submitted seed intent %j when global defaults change and on retry', async (seed) => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    const params = toDrawThingsTaskParams({ width: 512, height: 512, steps: 4, guidance: 1, negativePrompt: '', seed })
    const task = { id: 'seed', prompt: 'cat', model: 'm.ckpt', params }
    for (const globalSeed of [999, 888]) {
      configKnobs.seed = globalSeed
      await generateDrawThings(task as never, new AbortController().signal)
      const args = spawnCalls.at(-1)!.args
      if (seed) expect(args[args.indexOf('--seed') + 1]).toBe(seed)
      else expect(args).not.toContain('--seed')
    }
  })

  it('answers an already-aborted signal at the door, before any spawn', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    const controller = new AbortController()
    controller.abort()
    await expect(generateDrawThings({
      id: 't0', prompt: 'a cat', backend: 'drawthings', model: 'm.ckpt',
      params: {}, status: 'generating', enqueuedAt: '', startedAt: '', completedAt: null,
      durationMs: null, imagePath: null, baseName: null, error: null,
    } as never, controller.signal)).rejects.toThrow('Generation stopped.')
    expect(spawnCalls).toHaveLength(0)
  })

  // A wedged CLI is killed on the clock with the same SIGTERM→SIGKILL
  // escalation a Stop uses, and the task fails with a timeout error instead of
  // holding the single Draw Things slot forever.
  it('times out a CLI that never exits, with the escalating kill', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    hangUntilKilled = true
    configKnobs.timeoutMs = 50

    await expect(generateDrawThings({
      id: 'tt', prompt: 'a cat', backend: 'drawthings', model: 'm.ckpt',
      params: {}, status: 'generating', enqueuedAt: '', startedAt: '', completedAt: null,
      durationMs: null, imagePath: null, baseName: null, error: null,
    } as never, new AbortController().signal)).rejects.toThrow(/timed out after/)
    expect(killSignals).toContain('SIGTERM')
  })

  it('reads the CLI output while it runs, so a chatty CLI still finishes', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    configKnobs.timeoutMs = 500
    const result = await generateDrawThings({
      id: 'tc', prompt: 'a cat', backend: 'drawthings', model: 'm.ckpt',
      params: {}, status: 'generating', enqueuedAt: '', startedAt: '', completedAt: null,
      durationMs: null, imagePath: null, baseName: null, error: null,
    } as never, new AbortController().signal)
    expect(result.buffer.length).toBeGreaterThan(0)
    expect(killSignals).toEqual([])
  })

  it('stages the CLI output under temp/, never the session directory', async () => {
    const sessionDir = path.join(tmpRoot, 'sessions', 'a-session')
    fs.mkdirSync(sessionDir, { recursive: true })
    vi.doMock('../../../src/main/session', () => ({ getSessionDir: () => sessionDir }))

    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    const result = await generateDrawThings({
      id: 't1', prompt: 'a cat', backend: 'drawthings', model: 'm.ckpt',
      params: {}, status: 'generating', enqueuedAt: '', startedAt: '', completedAt: null,
      durationMs: null, imagePath: null, baseName: null, error: null,
    } as never, new AbortController().signal)

    expect(result.buffer.length).toBeGreaterThan(0)
    const outPath = spawnCalls[0].args[spawnCalls[0].args.indexOf('--output') + 1]
    expect(outPath.startsWith(path.join(tmpRoot, 'temp'))).toBe(true)
    expect(outPath.startsWith(sessionDir)).toBe(false)
    // Read-then-delete: nothing is left behind on the success path either.
    expect(fs.existsSync(outPath)).toBe(false)
    expect(fs.readdirSync(sessionDir)).toEqual([])
  })

  const task = (params: Record<string, unknown> = {}) => ({
    id: 'tm', prompt: 'a cat', backend: 'drawthings', model: 'm.ckpt',
    params, status: 'generating', enqueuedAt: '', startedAt: '', completedAt: null,
    durationMs: null, imagePath: null, baseName: null, error: null,
  }) as never

  // Volume handling: sizes the CLI accepts, tiled decoding, and no silent download.
  it('asks for a size the CLI accepts, tiled decoding, and no download of a missing model', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    await generateDrawThings(task({ width: 3840, height: 2160 }), new AbortController().signal)
    const args = spawnCalls[0].args
    expect(args[args.indexOf('--width') + 1]).toBe('3840')
    expect(args[args.indexOf('--height') + 1]).toBe('2176')
    expect(args).toContain('--no-download-missing')
    expect(JSON.parse(args[args.indexOf('--config-json') + 1])).toEqual({ tiledDecoding: true })
  })

  it.each([
    ['a failed Metal allocation', { code: 1, signal: null, stderr: 'Error: Failed to allocate buffer (out of memory)' }],
  ])('reports running out of memory after %s, at the size it was asked for, and removes the partial image', async (_name, ended) => {
    const { generateDrawThings, DrawThingsOutOfMemoryError } = await import('../../../src/main/backends/drawthings')
    exit = ended
    const failure = await generateDrawThings(task({ width: 3840, height: 2160 }), new AbortController().signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DrawThingsOutOfMemoryError)
    expect(failure).toMatchObject({ width: 3840, height: 2176 })
    const outPath = spawnCalls[0].args[spawnCalls[0].args.indexOf('--output') + 1]
    expect(fs.existsSync(outPath)).toBe(false)
  })

  it('keeps an ordinary CLI error as it is', async () => {
    const { generateDrawThings, DrawThingsOutOfMemoryError } = await import('../../../src/main/backends/drawthings')
    exit = { code: 1, signal: null, stderr: 'Error: model not found' }
    const failure = await generateDrawThings(task(), new AbortController().signal).catch((error: unknown) => error)
    expect(failure).not.toBeInstanceOf(DrawThingsOutOfMemoryError)
    expect(String(failure)).toContain('model not found')
  })

  it('snaps a custom size to the nearest multiple of 64 the CLI accepts', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    await generateDrawThings(task({ width: 1000, height: 700 }), new AbortController().signal)
    const args = spawnCalls[0].args
    expect([args[args.indexOf('--width') + 1], args[args.indexOf('--height') + 1]]).toEqual(['1024', '704'])
  })

  // The app's own kills are a timeout or a Stop, never "out of memory".
  it('reports a timeout, not running out of memory, when it kills a wedged run, and removes its partial image', async () => {
    const { generateDrawThings, DrawThingsOutOfMemoryError } = await import('../../../src/main/backends/drawthings')
    hangUntilKilled = true
    configKnobs.timeoutMs = 50
    const failure = await generateDrawThings(task({ width: 512, height: 512 }), new AbortController().signal).catch((error: unknown) => error)
    expect(failure).not.toBeInstanceOf(DrawThingsOutOfMemoryError)
    expect(String(failure)).toMatch(/timed out after/)
    const outPath = spawnCalls[0].args[spawnCalls[0].args.indexOf('--output') + 1]
    expect(fs.existsSync(outPath)).toBe(false)
  })

  it('reports a Stop as stopped, not as running out of memory, and removes its partial image', async () => {
    const { generateDrawThings, DrawThingsOutOfMemoryError } = await import('../../../src/main/backends/drawthings')
    hangUntilKilled = true
    const controller = new AbortController()
    const running = generateDrawThings(task(), controller.signal).catch((error: unknown) => error)
    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1))
    controller.abort()
    const failure = await running
    expect(failure).not.toBeInstanceOf(DrawThingsOutOfMemoryError)
    expect(String(failure)).toContain('Generation stopped.')
    const outPath = spawnCalls[0].args[spawnCalls[0].args.indexOf('--output') + 1]
    expect(fs.existsSync(outPath)).toBe(false)
  })

  it('waits for a resistant CLI to close before settling cancellation', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    hangUntilKilled = true
    ignoreTerm = true
    const controller = new AbortController()
    let settled = false
    const running = generateDrawThings(task(), controller.signal).catch((error: unknown) => error)
    void running.then(() => { settled = true })
    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1))
    controller.abort()
    expect(settled).toBe(false)
    expect(killSignals).toEqual(['SIGTERM'])
    const failure = await running
    expect(String(failure)).toContain('Generation stopped.')
    expect(killSignals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(recorded.failures).toHaveLength(1)
    const outPath = spawnCalls[0].args[spawnCalls[0].args.indexOf('--output') + 1]
    expect(fs.existsSync(outPath)).toBe(false)
  })

  it('keeps the whole CLI output and ending signal for an unexplained kill', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    exit = { code: null, signal: 'SIGKILL', stderr: 'loading model\nsampling step 3/4\n' }
    await generateDrawThings(task({ width: 3840, height: 2160 }), new AbortController().signal).catch(() => undefined)
    expect(recorded.failures).toHaveLength(1)
    expect(recorded.failures[0]!.answer).toMatchObject({ exitCode: null, signal: 'SIGKILL', stderr: 'loading model\nsampling step 3/4\n' })
  })

  it('decodes multibyte UTF-8 split across pipe chunks in both recorded streams', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    splitUtf8Output = true
    await generateDrawThings(task(), new AbortController().signal)
    expect(recorded.finished).toHaveLength(1)
    expect(recorded.finished[0]).toMatchObject({ stdout: '日本語 😀', stderr: '日本語 😀' })
  })

  it('explains a CLI that cannot start', async () => {
    const { generateDrawThings } = await import('../../../src/main/backends/drawthings')
    spawnFails = true
    await expect(generateDrawThings(task(), new AbortController().signal)).rejects.toThrow('Failed to spawn draw-things-cli: spawn ENOENT')
  })
})

// A signal alone is not evidence of memory exhaustion.
describe('isOutOfMemoryExit', () => {
  it.each([
    [null, 'SIGKILL', '', false],
    [null, 'SIGSEGV', 'segmentation fault', false],
    [null, 'SIGABRT', 'assertion failed', false],
    [1, null, 'MTLAllocation failed to allocate 2.1 GB', true],
    [134, null, 'Fatal error: Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)', true],
    [1, null, 'Error: Model not found: x.ckpt', false],
    [1, null, '', false],
    [0, null, '', false],
  ] as const)('code %s, signal %s, stderr %j is %s', async (code, signal, stderr, expected) => {
    const { isOutOfMemoryExit } = await import('../../../src/main/backends/drawthings')
    expect(isOutOfMemoryExit(code, signal, stderr)).toBe(expected)
  })
})

