import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, saveConfig, getConfigPath } from '../../../src/main/config'
import { createDefaultConfig } from '../../../src/main/config/defaults'

const ENV_VAR = 'IMAGEQUEUE_HOME'

// config-store persists config.json under the storage root via writeJsonAtomic
// (temp file + rename). These tests isolate the data dir with IMAGEQUEUE_HOME
// and assert the write is atomic: valid JSON lands on disk and no orphaned
// *.tmp artifact is left behind, mirroring the elaborators atomicity test.
describe('config store (atomic write of config.json)', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-config-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('seeds config.json with valid JSON and no leftover temp file on first load', () => {
    const configPath = getConfigPath()
    expect(configPath).toBe(path.join(tmpRoot, 'config.json'))

    // First load on an empty root seeds defaults and writes them out.
    const seeded = loadConfig()

    expect(fs.existsSync(configPath)).toBe(true)

    // The persisted file round-trips back as valid JSON equal to the defaults
    // (api-key fields are scrubbed but the default config has none populated).
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(parsed).toEqual(seeded)
    expect(parsed).toEqual(createDefaultConfig())

    // writeJsonAtomic writes "<file>.tmp" then renames; after a clean write the
    // temp artifact must be gone so no truncated/partial file is left behind.
    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false)
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('leaves no orphaned temp file after an explicit saveConfig', () => {
    const configPath = getConfigPath()

    const config = createDefaultConfig()
    config.general.export_dir = '/tmp/atomic-write-marker'
    saveConfig(config)

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(parsed.general.export_dir).toBe('/tmp/atomic-write-marker')

    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false)
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
