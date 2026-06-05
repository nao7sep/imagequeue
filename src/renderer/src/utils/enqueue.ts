import type { BackendId, EnqueueRequest } from '../../../shared/types'

export interface EnqueueConfigSnapshot {
  model: string
  params: Record<string, unknown>
  // Whether this column is currently able to enqueue (API key present for cloud
  // backends, CLI installed with at least one model for Draw Things). The column
  // owns this judgement; the builders below skip not-ready backends.
  ready: boolean
}

// Backend-config readiness, independent of the prompt: API key present for
// cloud backends; CLI installed with at least one downloaded model for Draw
// Things. (Draw Things has no API key, so apiKeyMissing is always false there.)
export function isBackendReadyToEnqueue(input: {
  backendId: BackendId
  apiKeyMissing: boolean
  cliInstalled: boolean
  downloadedModelCount: number
}): boolean {
  if (input.apiKeyMissing) return false
  if (input.backendId === 'drawthings') {
    return input.cliInstalled && input.downloadedModelCount > 0
  }
  return true
}

// Composes a single enqueue request from a prompt and a backend's current
// snapshot, or null when there's nothing to enqueue: a blank prompt, no
// snapshot, or a backend that isn't ready. Pure — the caller dispatches.
export function buildEnqueueRequest(
  backend: BackendId,
  prompt: string,
  snapshot: EnqueueConfigSnapshot | undefined
): EnqueueRequest | null {
  const text = prompt.trim()
  if (!text) return null
  if (!snapshot || !snapshot.ready) return null
  return { prompt: text, backend, model: snapshot.model, params: snapshot.params, count: 1 }
}

// Composes one request per backend, in the given order, skipping any that lack
// a snapshot or aren't ready. Used by "Send to All".
export function buildEnqueueRequestsForAll(
  prompt: string,
  snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>>,
  backends: BackendId[]
): EnqueueRequest[] {
  const requests: EnqueueRequest[] = []
  for (const backend of backends) {
    const request = buildEnqueueRequest(backend, prompt, snapshots[backend])
    if (request) requests.push(request)
  }
  return requests
}
