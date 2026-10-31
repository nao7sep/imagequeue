import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FILE_FORMATS, type FileFormat } from '../../src/main/store-format'
import { header } from './file-header'

// Every file the launch opens is read before anything is written; a refused
// one stops the launch, and every refused file is named in the one stop.
describe('the launch check', () => {
  let root: string
  const put = (name: string, bytes: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), bytes)
  }
  const newer = (format: FileFormat, content: Record<string, unknown> = {}): string =>
    JSON.stringify({ ...header(format, format.version + 1), ...content })
  const snapshot = (): Record<string, string> => Object.fromEntries(
    (fs.readdirSync(root, { recursive: true }) as string[]).sort().map((name) => {
      const full = path.join(root, name)
      return [name, fs.statSync(full).isDirectory() ? '<dir>' : fs.readFileSync(full, 'utf8')]
    }))
  const check = async (): Promise<unknown> => {
    const { checkLaunchFiles } = await import('../../src/main/launch-files')
    try { checkLaunchFiles() } catch (error) { return error }
    return null
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-launch-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('passes a fresh data folder, writing nothing', async () => {
    expect(await check()).toBeNull()
    expect(snapshot()).toEqual({})
  })

  it('names every refused file, newer or unreadable, and writes nothing before stopping', async () => {
    put('config.json', '{ invalid')
    put('elaborators.json', newer(FILE_FORMATS.elaborators))
    put('params.json', JSON.stringify({ models: {} }))
    put('backend-params.json', JSON.stringify({ ...header(FILE_FORMATS.config), backends: {} }))
    put('api-keys.json', JSON.stringify({ keys: {} }))
    put('state.json', newer(FILE_FORMATS.uiState))
    put('dependencies.json', newer(FILE_FORMATS.dependencies))
    put('bin/draw-things-cli.json', newer(FILE_FORMATS.cliSidecar))
    put('recommendations-times.json', newer(FILE_FORMATS.recommendationsTimes))
    const before = snapshot()

    const error = await check()
    expect(error).toMatchObject({ name: 'LaunchStopError' })
    expect((error as { refused: unknown[] }).refused).toEqual([
      { path: path.join(root, 'config.json'), newer: false },
      { path: path.join(root, 'elaborators.json'), newer: true },
      { path: path.join(root, 'params.json'), newer: false },
      { path: path.join(root, 'backend-params.json'), newer: false },
      { path: path.join(root, 'api-keys.json'), newer: false },
      { path: path.join(root, 'state.json'), newer: true },
      { path: path.join(root, 'dependencies.json'), newer: true },
      { path: path.join(root, 'bin', 'draw-things-cli.json'), newer: true },
      { path: path.join(root, 'recommendations-times.json'), newer: true },
    ])
    expect(snapshot()).toEqual(before)
  })

  it('lets unreadable caches through, to be rebuilt, without touching them', async () => {
    put('state.json', '{ invalid')
    put('dependencies.json', JSON.stringify({ lastAttemptAtUtc: null }))
    put('bin/draw-things-cli.json', JSON.stringify({ ...header(FILE_FORMATS.config) }))
    put('recommendations-times.json', '[]')
    const before = snapshot()
    expect(await check()).toBeNull()
    expect(snapshot()).toEqual(before)
  })
})
