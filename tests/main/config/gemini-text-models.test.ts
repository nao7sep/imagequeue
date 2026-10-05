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
  it('stores a role\'s thinking only while it differs from the selected model\'s default', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    const file = (): unknown => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'))
    updateConfig((draft) => { draft.openai.thinking.slug = 'none' })
    expect(fs.existsSync(path.join(root, 'config.json'))).toBe(false)
    updateConfig((draft) => { draft.openai.thinking.slug = 'high' })
    expect(file()).toEqual({ openai: { thinking: { slug: 'high' } } })
    // The default is the model's tier's, medium on the smart Sol, not the fast role's.
    updateConfig((draft) => { draft.openai.slug = 'gpt-6.1-sol'; draft.openai.thinking.slug = 'medium' })
    expect(file()).toEqual({ openai: { slug: 'gpt-6.1-sol' } })
    updateConfig((draft) => { draft.openai.thinking.slug = 'max' })
    // Under a model with no row the choice is kept, unsent, for when a listed row returns.
    updateConfig((draft) => { draft.openai.slug = 'local-model' })
    expect(file()).toEqual({ openai: { slug: 'local-model', thinking: { slug: 'max' } } })
  })
  it('sends the role\'s default when the stored thinking is one the selected row does not list', async () => {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ provider: 'openai', openai: { thinking: { slug: 'minimal', elaboration: 'xhigh' } } }))
    vi.doMock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'test-key' }))
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { getLightProvider, getMainProvider } = await import('../../../src/main/text-ai')
      const ask = { messages: [{ role: 'user' as const, text: 'p' }], timeoutMs: 1000, record: { purpose: 'test' } }
      await getLightProvider()!.provider.ask(ask)
      await getMainProvider()!.provider.ask(ask)
      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string).reasoning_effort)).toEqual(['none', 'xhigh'])
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('../../../src/main/config/api-keys-store')
    }
  })
})
