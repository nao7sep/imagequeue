import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_ENDPOINTS } from '../../../src/shared/ai-models'
import type { ModelLists } from '../../../src/shared/model-lists'

const state = vi.hoisted(() => ({
  root: '', keys: { gemini: '', openai: '' },
  config: { gemini: { endpoint: 'https://generativelanguage.googleapis.com' }, openai: { endpoint: 'https://api.openai.com/v1' } },
  log: vi.fn(),
}))
vi.mock('../../../src/main/config', () => ({ loadConfig: () => state.config, getDataDir: () => state.root }))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: (id: string) => state.keys[id.split('.')[0] as 'gemini' | 'openai'] }))
vi.mock('../../../src/main/logger', () => ({ log: state.log, serializeError: (error: unknown) => error }))

beforeEach(() => {
  vi.resetModules()
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-model-lists-'))
  state.keys = { gemini: '', openai: '' }
  state.config = { gemini: { endpoint: PROVIDER_ENDPOINTS.gemini }, openai: { endpoint: PROVIDER_ENDPOINTS.openai } }
  state.log.mockClear()
})
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(state.root, { recursive: true, force: true }) })
const file = () => path.join(state.root, 'model-lists.json')
const read = (): ModelLists => JSON.parse(fs.readFileSync(file(), 'utf8'))
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

describe('text picker model list facts', () => {
  it('does not fetch at import, on a config read, or without a configured key', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const service = await import('../../../src/main/text-ai/model-lists')
    expect(fetch).not.toHaveBeenCalled()
    expect(await service.openTextModelLists()).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
    expect(fs.existsSync(file())).toBe(false)
  })
  it('filters both providers, persists their facts together, refreshes once daily, and permits manual refresh', async () => {
    state.keys = { gemini: 'gemini-fixture', openai: 'openai-fixture' }
    state.config.openai.endpoint = 'https://proxy.example/v1'
    const fetch = vi.fn(async (url: string) => url.includes('/models') && url.startsWith('https://proxy')
      ? json({ data: [{ id: 'gpt-6.1-sol' }, { id: 'embedding-model' }, { id: 'gpt-image-2' }] })
      : json({ models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-3.1-flash-image' }, { name: 'models/embedding-model' }] }))
    vi.stubGlobal('fetch', fetch)
    const service = await import('../../../src/main/text-ai/model-lists')
    const lists = await service.openTextModelLists()
    expect(lists.gemini?.ids).toEqual(['gemini-3.8-flash'])
    expect(lists.openai?.ids).toEqual(['gpt-6.1-sol'])
    expect(read()).toEqual(lists)
    expect(Object.keys(read().openai!)).toEqual(['fetchedAtUtc', 'ids'])
    expect(fetch.mock.calls.some(([url]) => url === 'https://proxy.example/v1/models')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    await service.openTextModelLists()
    expect(fetch).toHaveBeenCalledTimes(2)
    await service.refreshModelList('openai', true)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fs.existsSync(path.join(state.root, 'config.json'))).toBe(false)
    expect(fs.existsSync(path.join(state.root, 'backups.sqlite3'))).toBe(false)
  })
  it('keeps cached ids on failure and does not repeatedly retry a failed refresh', async () => {
    state.keys.openai = 'fixture'
    const previous = { openai: { fetchedAtUtc: '2020-01-01T00:00:00Z', ids: ['gpt-old'] } }
    fs.writeFileSync(file(), JSON.stringify(previous))
    const fetch = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const service = await import('../../../src/main/text-ai/model-lists')
    expect(await service.openTextModelLists()).toEqual(previous)
    expect(await service.openTextModelLists()).toEqual(previous)
    expect(read()).toEqual(previous)
    expect(fetch).toHaveBeenCalledOnce()
    expect(state.log.mock.calls.filter(([, message]) => String(message).includes('refresh failed'))).toHaveLength(1)
  })
  it('coalesces simultaneous opens and discards a response after endpoint changes', async () => {
    state.keys.openai = 'fixture'
    let answer!: (response: Response) => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const fetch = vi.fn(async () => { started(); return new Promise<Response>((resolve) => { answer = resolve }) })
    vi.stubGlobal('fetch', fetch)
    const service = await import('../../../src/main/text-ai/model-lists')
    const first = service.refreshModelList('openai')
    const second = service.refreshModelList('openai')
    expect(first).toBe(second)
    await entered
    state.config.openai.endpoint = 'https://changed.example/v1'
    answer(json({ data: [{ id: 'gpt-future' }] }))
    expect(await first).toEqual({})
    expect(fs.existsSync(file())).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
