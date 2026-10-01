import fs from 'node:fs/promises'
import path from 'node:path'
import { GoogleGenAI } from '@google/genai'
import { loadConfig, getDataDir } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { log, serializeError } from '../logger'
import { writeFileAtomicAsync } from '../utils/atomic-write'
import { isObject } from '../config/config-sets'
import { isTextModel } from '../../shared/model-registry'
import { PROVIDER_ENDPOINTS, TEXT_PROVIDERS } from '../../shared/ai-models'
import type { TextAIBackendId } from '../../shared/types'
import type { ModelLists } from '../../shared/model-lists'
import { shutdownSignal } from '../backends/cancellation'

const DAY_MS = 86400000
const FETCH_TIMEOUT_MS = 30000
const inFlight = new Map<TextAIBackendId, Promise<ModelLists>>()
const lastAttempt = new Map<TextAIBackendId, number>()
// Store writes merge the other provider's latest fact, serialized in-process.
let pendingWrite: Promise<void> = Promise.resolve()

function listPath(): string { return path.join(getDataDir(), 'model-lists.json') }

export async function readModelLists(signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)): Promise<ModelLists> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(listPath(), { encoding: 'utf8', signal }))
    if (!isObject(raw)) throw new Error('Model lists must be an object')
    const lists: ModelLists = {}
    for (const provider of TEXT_PROVIDERS) {
      const fact = raw[provider]
      if (isObject(fact) && typeof fact.fetchedAtUtc === 'string' && Number.isFinite(Date.parse(fact.fetchedAtUtc))
        && Array.isArray(fact.ids) && fact.ids.every((id) => typeof id === 'string')) {
        lists[provider] = { fetchedAtUtc: fact.fetchedAtUtc, ids: fact.ids }
      }
    }
    return lists
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log('warn', 'Model lists unavailable; using bundled suggestions', { error: serializeError(error) })
    return {}
  }
}

export async function fetchTextModelIds(provider: TextAIBackendId, endpoint: string, apiKey: string, signal: AbortSignal): Promise<string[]> {
  const ids: string[] = []
  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { baseUrl: endpoint || PROVIDER_ENDPOINTS.gemini,
      timeout: FETCH_TIMEOUT_MS, retryOptions: { attempts: 1 } } })
    const models = await ai.models.list({ config: { abortSignal: signal } })
    for await (const model of models) {
      signal.throwIfAborted()
      if (model.name) ids.push(model.name.replace(/^models\//, ''))
    }
  } else {
    const response = await fetch(`${(endpoint || PROVIDER_ENDPOINTS.openai).replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal,
    })
    if (!response.ok) throw new Error(`OpenAI model list failed (${response.status})`)
    const body: unknown = await response.json()
    if (!isObject(body) || !Array.isArray(body.data)) throw new Error('Invalid OpenAI model list')
    for (const row of body.data) if (isObject(row) && typeof row.id === 'string') ids.push(row.id)
  }
  return [...new Set(ids)].filter((id) => isTextModel(id, provider))
}

export function refreshModelList(provider: TextAIBackendId, force = false): Promise<ModelLists> {
  const current = inFlight.get(provider)
  if (current) return current
  // Claim before any await, including reading the facts cache.
  const running = refresh(provider, force).finally(() => { inFlight.delete(provider) })
  inFlight.set(provider, running)
  return running
}

async function refresh(provider: TextAIBackendId, force: boolean): Promise<ModelLists> {
  const lists = await readModelLists()
  const fetchedAt = lists[provider]?.fetchedAtUtc
  if (!force && Date.now() - Math.max(lastAttempt.get(provider) ?? 0, fetchedAt ? Date.parse(fetchedAt) : 0) < DAY_MS) return lists
  const config = loadConfig()
  const endpoint = config[provider].endpoint
  const key = resolveApiKey(`${provider}.text`)
  if (!key) return lists
  lastAttempt.set(provider, Date.now())
  const signal = AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), shutdownSignal()])
  try {
    const ids = await fetchTextModelIds(provider, endpoint, key, signal)
    // Settings may have been saved while the request was in flight.
    if (loadConfig()[provider].endpoint !== endpoint || resolveApiKey(`${provider}.text`) !== key) return readModelLists()
    const fact = { fetchedAtUtc: new Date().toISOString(), ids }
    const write = pendingWrite.catch(() => undefined).then(async () => {
      const latest = await readModelLists()
      await writeFileAtomicAsync(listPath(), JSON.stringify({ ...latest, [provider]: fact }, null, 2), false, signal,
        () => loadConfig()[provider].endpoint === endpoint && resolveApiKey(`${provider}.text`) === key)
    })
    pendingWrite = write
    await write
    return readModelLists()
  } catch (error) {
    log('warn', 'Provider model list refresh failed; keeping available suggestions', { provider, error: serializeError(error) })
    return readModelLists()
  }
}

// Called only when Settings opens or the user presses Refresh.
export async function openTextModelLists(): Promise<ModelLists> {
  await Promise.all(TEXT_PROVIDERS.map((provider) => refreshModelList(provider)))
  return readModelLists()
}
