import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Draw Things is the ONE backend where an external process owns the output file:
// the CLI writes it, the app reads it in and deletes it. That file must be staged
// in the app's temp directory, never the session directory — if the app dies
// between spawn and read, the CLI finishes writing into a folder nobody is
// watching, and in the session folder that left a permanent `drawthings-<id>.png`
// the app never handled. In temp it is swept by clearTempDir at the next launch.

const spawnCalls: { args: string[] }[] = []

vi.mock('node:child_process', () => ({ spawn: (_cmd: string, args: string[]) => makeProc(args) }))
vi.mock('child_process', () => ({ spawn: (_cmd: string, args: string[]) => makeProc(args) }))

function makeProc(args: string[]): EventEmitter & { stderr: EventEmitter } {
  spawnCalls.push({ args })
  const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter() })
  // Write the file the CLI would produce, then report success.
  const outIndex = args.indexOf('--output')
  const outPath = args[outIndex + 1]
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  setTimeout(() => proc.emit('close', 0), 0)
  return proc
}

vi.mock('../../../src/main/local-cli', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCliPath: () => '/fake/draw-things-cli',
  resolveModelsDir: () => '/fake/models',
}))

const ENV_VAR = 'IMAGEQUEUE_HOME'

describe('Draw Things output staging', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    spawnCalls.length = 0
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-dt-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    vi.resetModules()
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

  it('stages the CLI output under temp/, never the session directory', async () => {
    const sessionDir = path.join(tmpRoot, 'output', 'a-session')
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
})
