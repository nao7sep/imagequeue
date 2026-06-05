import { describe, expect, it } from 'vitest'
import type { BackendId } from '../../../../src/shared/types'
import {
  buildEnqueueRequest,
  buildEnqueueRequestsForAll,
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
      backendId: 'imagen', apiKeyMissing: false, cliInstalled: false, downloadedModelCount: 0,
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

  it('builds a trimmed, count-1 request carrying the snapshot model and params', () => {
    const snapshot = readySnapshot()
    expect(buildEnqueueRequest('openai', '  a cat  ', snapshot)).toEqual({
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
      imagen: readySnapshot({ model: 'imagen-4' }),
    }
    const order: BackendId[] = ['imagen', 'openai']
    const requests = buildEnqueueRequestsForAll('a cat', snapshots, order)
    expect(requests.map((r) => r.backend)).toEqual(['imagen', 'openai'])
    expect(requests.every((r) => r.prompt === 'a cat' && r.count === 1)).toBe(true)
  })

  it('skips backends that are missing a snapshot or not ready', () => {
    const snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>> = {
      openai: readySnapshot(),
      imagen: readySnapshot({ ready: false }),
      // grok intentionally absent
    }
    const order: BackendId[] = ['openai', 'imagen', 'grok']
    const requests = buildEnqueueRequestsForAll('a cat', snapshots, order)
    expect(requests.map((r) => r.backend)).toEqual(['openai'])
  })

  it('returns nothing for a blank prompt', () => {
    const snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>> = { openai: readySnapshot() }
    expect(buildEnqueueRequestsForAll('  ', snapshots, ['openai'])).toEqual([])
  })
})
