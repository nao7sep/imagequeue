import { describe, expect, it } from 'vitest'
import type { BackendId } from '../../../../src/shared/types'
import {
  buildEnqueueRequest,
  buildEnqueueRequestsForAll,
  hasApiKeyFor,
  isBackendReadyToEnqueue,
  type EnqueueConfigSnapshot,
} from '../../../../src/renderer/src/utils/enqueue'

const readySnapshot = (over: Partial<EnqueueConfigSnapshot> = {}): EnqueueConfigSnapshot => ({
  model: 'gpt-image-2',
  params: { width: 1024, height: 1024 },
  ready: true,
  ...over,
})

describe('isBackendReadyToEnqueue', () => {
  it('is false for a cloud backend with a missing API key', () => {
    expect(isBackendReadyToEnqueue({
      backendId: 'openai', apiKeyMissing: true, cliInstalled: false, downloadedModelCount: 0,
    })).toBe(false)
  })

  it('is true for a cloud backend with an API key', () => {
    expect(isBackendReadyToEnqueue({
      backendId: 'nanobanana', apiKeyMissing: false, cliInstalled: false, downloadedModelCount: 0,
    })).toBe(true)
  })

  it('requires the CLI and at least one model for Draw Things', () => {
    const base = { backendId: 'drawthings' as const, apiKeyMissing: false }
    expect(isBackendReadyToEnqueue({ ...base, cliInstalled: false, downloadedModelCount: 3 })).toBe(false)
    expect(isBackendReadyToEnqueue({ ...base, cliInstalled: true, downloadedModelCount: 0 })).toBe(false)
    expect(isBackendReadyToEnqueue({ ...base, cliInstalled: true, downloadedModelCount: 1 })).toBe(true)
  })
})

describe('buildEnqueueRequest', () => {
  it('returns null for a blank or whitespace-only prompt', () => {
    expect(buildEnqueueRequest('openai', '', readySnapshot())).toBeNull()
    expect(buildEnqueueRequest('openai', '   \n\t ', readySnapshot())).toBeNull()
  })

  it('returns null when there is no snapshot', () => {
    expect(buildEnqueueRequest('openai', 'a cat', undefined)).toBeNull()
  })

  it('returns null when the backend is not ready', () => {
    expect(buildEnqueueRequest('openai', 'a cat', readySnapshot({ ready: false }))).toBeNull()
  })

  it('builds a multiline-cleaned, count-1 request carrying the snapshot model and params', () => {
    const snapshot = readySnapshot()
    // Multiline cleanup: edge blank lines drop, trailing whitespace trims, and
    // interior line structure (and leading indentation) is preserved.
    expect(buildEnqueueRequest('openai', '\n\na cat  \n\n', snapshot)).toEqual({
      prompt: 'a cat',
      backend: 'openai',
      model: snapshot.model,
      params: snapshot.params,
      count: 1,
    })
  })
})

describe('buildEnqueueRequestsForAll', () => {
  it('emits one request per ready backend, preserving the given order', () => {
    const snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>> = {
      openai: readySnapshot({ model: 'gpt-image-2' }),
      nanobanana: readySnapshot({ model: 'gemini-3.1-flash-image' }),
    }
    const order: BackendId[] = ['nanobanana', 'openai']
    const requests = buildEnqueueRequestsForAll('a cat', snapshots, order)
    expect(requests.map((r) => r.backend)).toEqual(['nanobanana', 'openai'])
    expect(requests.every((r) => r.prompt === 'a cat' && r.count === 1)).toBe(true)
  })

  it('skips backends that are missing a snapshot or not ready', () => {
    const snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>> = {
      openai: readySnapshot(),
      nanobanana: readySnapshot({ ready: false }),
      // grok intentionally absent
    }
    const order: BackendId[] = ['openai', 'nanobanana', 'grok']
    const requests = buildEnqueueRequestsForAll('a cat', snapshots, order)
    expect(requests.map((r) => r.backend)).toEqual(['openai'])
  })

  it('returns nothing for a blank prompt', () => {
    const snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>> = { openai: readySnapshot() }
    expect(buildEnqueueRequestsForAll('  ', snapshots, ['openai'])).toEqual([])
  })
})


// The bug this guards: key presence must come from the main process, which
// resolves the environment first. A backend keyed only by OPENAI_IMAGE_API_KEY
// is invisible to the settings payload — which carries no keys at all — so
// anything reading settings reported "API key not set" and disabled + Queue for
// a backend the main process would have called successfully.
describe('hasApiKeyFor', () => {
  it('reports a backend keyed only by environment as present', () => {
    // What the main process returns when the key came from the environment and
    // nothing is stored — the exact case the old stored-string check got wrong.
    expect(hasApiKeyFor('openai', { image: { openai: true, nanobanana: false, grok: false, flux: false } })).toBe(true)
  })

  it('reports an unkeyed backend as absent', () => {
    expect(hasApiKeyFor('flux', { image: { openai: true, nanobanana: false, grok: false, flux: false } })).toBe(false)
  })

  it('needs no key for Draw Things, whatever presence says', () => {
    expect(hasApiKeyFor('drawthings', { image: { openai: false, nanobanana: false, grok: false, flux: false } })).toBe(true)
    expect(hasApiKeyFor('drawthings', null)).toBe(true)
  })

  it('treats not-yet-loaded presence as present, so no column flickers unconfigured at startup', () => {
    expect(hasApiKeyFor('openai', null)).toBe(true)
  })
})
