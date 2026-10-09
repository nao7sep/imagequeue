import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, saveConfig, updateConfig, getConfigPath } from '../../../src/main/config'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { closeBackupStore } from '../../../src/main/backup/backup-store'
import { writeFileAtomicAsync } from '../../../src/main/utils/atomic-write'

const ENV_VAR = 'IMAGEQUEUE_DATA_DIR'

// config-store persists config.json under the storage root via writeFileAtomicAsync
// (temp file + rename). These tests isolate the data dir with IMAGEQUEUE_DATA_DIR
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
    // config.json is a recorded managed-text write; close the store singleton so the next test re-opens
    // it against its own fresh IMAGEQUEUE_DATA_DIR rather than the previous, now-deleted throwaway root.
    closeBackupStore()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('leaves no orphaned temp file after an explicit saveConfig', async () => {
    const configPath = getConfigPath()

    const config = createDefaultConfig()
    config.general.export_dir = '/tmp/atomic-write-marker'
    await saveConfig(config)

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(parsed.general.export_dir).toBe('/tmp/atomic-write-marker')

    expect(fs.existsSync(`${configPath}.tmp`)).toBe(false)
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('writes through a temp file named `<stem>-<nanoid>.tmp` in the same directory as config.json', async () => {
    const spy = vi.spyOn(fs.promises, 'open')
    const config = createDefaultConfig()
    config.general.language = 'ja'
    await saveConfig(config)

    const tempCall = spy.mock.calls.find((call) =>
      typeof call[0] === 'string' && (call[0] as string).endsWith('.tmp')
    )
    expect(tempCall).toBeDefined()
    const tempPath = tempCall![0] as string
    expect(path.dirname(tempPath)).toBe(tmpRoot)
    expect(path.basename(tempPath)).toMatch(/^config-[A-Za-z0-9_-]+\.tmp$/)
    spy.mockRestore()
  })

  it('syncs staged bytes before publication', async () => {
    const events: string[] = []
    const originalOpen = fs.promises.open.bind(fs.promises)
    const open = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      const sync = handle.sync.bind(handle)
      handle.sync = async () => { events.push('sync'); await sync() }
      return handle
    })
    const renameOriginal = fs.promises.rename.bind(fs.promises)
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args) => {
      events.push('rename')
      await renameOriginal(...args)
    })
    await updateConfig((draft) => { draft.general.language = loadConfig().general.language === 'ja' ? 'en' : 'ja' })
    expect(events.indexOf('sync')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('sync')).toBeLessThan(events.indexOf('rename'))
    open.mockRestore()
    rename.mockRestore()
  })

  it('removes staging when publication fails', async () => {
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(() => {
      throw new Error('simulated rename failure')
    })
    await expect(updateConfig((draft) => { draft.general.language = loadConfig().general.language === 'ja' ? 'en' : 'ja' })).rejects.toThrow('simulated rename failure')
    rename.mockRestore()
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  // The cached config is what the processor and backends read. A save that
  // fails must not leave the new values running in memory, where the next
  // unrelated save would also write them to disk unnoticed.
  it('keeps the running settings when an update cannot be written', async () => {
    // The cache outlives each test's data root; write it into this one first.
    const before = await updateConfig((draft) => { draft.image_backends.openai.timeout_ms = 180001 })
    const timeout = before.image_backends.openai.timeout_ms
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(() => {
      throw new Error('simulated disk full')
    })
    await expect(updateConfig((draft) => { draft.image_backends.openai.timeout_ms = 1 })).rejects.toThrow('simulated disk full')
    rename.mockRestore()

    expect(loadConfig().image_backends.openai.timeout_ms).toBe(timeout)
    expect(JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8')).image_backends.openai.timeout_ms).toBe(timeout)
  })

  it('applies an update once it is written', async () => {
    loadConfig()
    const saved = await updateConfig((draft) => { draft.image_backends.openai.timeout_ms = 1234 })
    expect(loadConfig()).toBe(saved)
    expect(JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8')).image_backends.openai.timeout_ms).toBe(1234)
  })

  it('publishes async acquisition bytes and leaves no staging file', async () => {
    const destination = path.join(tmpRoot, 'configs.json')
    await writeFileAtomicAsync(destination, Buffer.from('{"ok":true}'), false)
    expect(fs.readFileSync(destination, 'utf8')).toBe('{"ok":true}')
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('cleans async acquisition staging when publication fails', async () => {
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
      new Error('simulated async rename failure')
    )
    await expect(
      writeFileAtomicAsync(path.join(tmpRoot, 'configs.json'), Buffer.from('{"ok":true}'), false)
    ).rejects.toThrow('simulated async rename failure')
    rename.mockRestore()
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
