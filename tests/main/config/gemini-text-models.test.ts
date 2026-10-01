import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-text-models-'))
  vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
  vi.resetModules()
})
afterEach(async () => {
  const { closeBackupStore } = await import('../../../src/main/backup/backup-store')
  closeBackupStore()
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('open text model sets', () => {
  it('preserves arbitrary role ids and writes only the changed role', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    const config = updateConfig((draft) => { draft.gemini.elaboration = 'unknown-future-id' })
    expect(config.gemini.elaboration).toBe('unknown-future-id')
    expect(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'))).toEqual({ gemini: { elaboration: 'unknown-future-id' } })
  })
  it('drops renamed keys at the next write without migrating them', async () => {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      text_ai: { backend: 'openai', gemini: { main_model: 'old', light_model: 'old', timeout_ms: 40000 },
        openai: { endpoint: 'https://old.example' } },
      gemini: { slug: 'my-slug' },
    }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().provider).toBe('gemini')
    expect(loadConfig().gemini.elaboration).toBe('gemini-3.8-flash')
    expect(loadConfig().gemini.slug).toBe('my-slug')
    expect(loadConfig().gemini.timeout_ms).toBe(30000)
    updateConfig((draft) => { draft.provider = 'openai' })
    expect(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'))).toEqual({
      provider: 'openai', gemini: { slug: 'my-slug' },
    })
  })
  it('stores a provider timeout as its own set beside the provider\'s other sets', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.openai.timeout_ms = 90000 })
    expect(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'))).toEqual({ openai: { timeout_ms: 90000 } })
  })
  it('stores extras as one whole set and rejects a malformed set as absent', async () => {
    const { updateConfig, loadConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.extraModelIds = { gemini: ['custom'], openai: ['local-id'] } })
    expect(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'))).toEqual({ extraModelIds: { gemini: ['custom'], openai: ['local-id'] } })
    fs.writeFileSync(path.join(root, 'config.json'), '{"extraModelIds":{"gemini":[7]}}')
    vi.resetModules()
    const store = await import('../../../src/main/config/config-store')
    expect(store.loadConfig().extraModelIds).toEqual({})
    expect(loadConfig().extraModelIds).toEqual({ gemini: ['custom'], openai: ['local-id'] })
  })
})
