import type { Worker } from 'node:worker_threads'
import createConceptWorker from './concept-worker?nodeWorker'
import { getDataDir } from '../config'
import { log } from '../logger'
import { NewerFormatError, StoreLeftInPlaceError } from '../store-format'
import type * as Database from './concept-database'
export type { FacetRow, ProbeRow, DrawOptions, DrawnConcept, ConceptFacetSummary, ConceptListRow, ConceptProbeSummary } from './concept-database'
export const CONCEPT_REUSE_WINDOW_DRAWS = 1000
let worker: Worker | null = null
let failed: Error | null = null
let nextId = 0
let closing: Promise<void> | null = null
export const CONCEPT_REQUEST_TIMEOUT_MS = 10_000
const paths: string[] = []
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>()
export function drainSetAsideConceptStorePaths(): string[] { return paths.splice(0) }
function owner(): Worker {
  if (failed) throw failed
  if (worker) return worker
  const started = createConceptWorker({ workerData: { dataDir: getDataDir() } })
  worker = started
  started.unref()
  started.on('message', (message) => {
    if (message.type === 'log') { log(message.level, message.message, message.fields); return }
    paths.push(...message.paths)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) {
      const e = message.error
      const error = e.name === 'NewerFormatError' ? new NewerFormatError(e.path, e.found, e.supported)
        : e.name === 'StoreLeftInPlaceError' ? new StoreLeftInPlaceError(e.path, { cause: e.cause })
        : Object.assign(new Error(e.message), e)
      request.reject(error)
    } else request.resolve(message.value)
  })
  const stop = (error: Error): void => {
    if (worker !== started) return
    failed = error
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear()
  }
  started.on('error', stop)
  started.on('exit', () => stop(new Error('The concept library worker exited.')))
  return started
}
function request<T>(op: string, args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (closing) { reject(new Error('The concept library is closing.')); return }
    const current = owner()
    const id = ++nextId
    // A caller deadline does not release the serial writer or cancel its SQL.
    // Later operations stay behind the actual completion in the same mailbox.
    const timer = op === 'closeConceptStore' ? undefined : setTimeout(() => {
      pending.delete(id)
      reject(new Error('The concept library did not respond in time. Its current operation may still finish.'))
    }, CONCEPT_REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    try { current.postMessage({ id, op, args }) }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
  })
}
/** Ordered after every admitted ledger operation, including ones whose caller was cancelled. */
export function closeConceptStore(): Promise<void> {
  if (closing) return closing
  if (!worker) return Promise.resolve()
  const current = worker
  const drained = failed ? Promise.resolve() : request('closeConceptStore', [])
  closing = drained.then(() => undefined).finally(() => {
    worker = null
    failed = null
    closing = null
    void current.terminate().catch((error) => log('warn', 'Concept library thread could not terminate', { error: String(error) }))
  })
  return closing
}
export const ensureFacet = (...args: Parameters<typeof Database.ensureFacet>): Promise<ReturnType<typeof Database.ensureFacet>> => request('ensureFacet', args)
export const listFacetDisplays = (...args: Parameters<typeof Database.listFacetDisplays>): Promise<ReturnType<typeof Database.listFacetDisplays>> => request('listFacetDisplays', args)
export const addProbes = (...args: Parameters<typeof Database.addProbes>): Promise<ReturnType<typeof Database.addProbes>> => request('addProbes', args)
export const listProbeDisplays = (...args: Parameters<typeof Database.listProbeDisplays>): Promise<ReturnType<typeof Database.listProbeDisplays>> => request('listProbeDisplays', args)
export const unexpandedProbes = (...args: Parameters<typeof Database.unexpandedProbes>): Promise<ReturnType<typeof Database.unexpandedProbes>> => request('unexpandedProbes', args)
export const markProbeExpanded = (...args: Parameters<typeof Database.markProbeExpanded>): Promise<ReturnType<typeof Database.markProbeExpanded>> => request('markProbeExpanded', args)
export const addConcepts = (...args: Parameters<typeof Database.addConcepts>): Promise<ReturnType<typeof Database.addConcepts>> => request('addConcepts', args)
export const drawConcept = (...args: Parameters<typeof Database.drawConcept>): Promise<ReturnType<typeof Database.drawConcept>> => request('drawConcept', args)
export const recordUse = (...args: Parameters<typeof Database.recordUse>): Promise<ReturnType<typeof Database.recordUse>> => request('recordUse', args)
export const listFacetsWithStats = (...args: Parameters<typeof Database.listFacetsWithStats>): Promise<ReturnType<typeof Database.listFacetsWithStats>> => request('listFacetsWithStats', args)
export const listConceptRows = (...args: Parameters<typeof Database.listConceptRows>): Promise<ReturnType<typeof Database.listConceptRows>> => request('listConceptRows', args)
export const listProbesWithStats = (...args: Parameters<typeof Database.listProbesWithStats>): Promise<ReturnType<typeof Database.listProbesWithStats>> => request('listProbesWithStats', args)
export const deleteProbe = (...args: Parameters<typeof Database.deleteProbe>): Promise<ReturnType<typeof Database.deleteProbe>> => request('deleteProbe', args)
export const deleteConcept = (...args: Parameters<typeof Database.deleteConcept>): Promise<ReturnType<typeof Database.deleteConcept>> => request('deleteConcept', args)
export const deleteFacet = (...args: Parameters<typeof Database.deleteFacet>): Promise<ReturnType<typeof Database.deleteFacet>> => request('deleteFacet', args)
