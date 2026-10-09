import { updateConfig } from './config'
import { createCoalescedWriter } from './utils/coalesced-writer'
import type { CloudBackendId } from '../shared/types'
import { log, serializeError } from './logger'

type Edit = { model: string; params: Record<string, unknown> }
const pending = new Map<CloudBackendId, Edit>()
let waiters: { resolve: () => void; reject: (error: unknown) => void }[] = []
const writer = createCoalescedWriter({
  debounceMs: 800,
  async flush() {
    const edits = new Map(pending)
    const completing = waiters
    waiters = []
    try {
      await updateConfig((draft) => {
        for (const [backend, edit] of edits) {
          Object.assign(draft.image_backends[backend], { model: edit.model, default_params: edit.params })
        }
      })
      for (const [backend, edit] of edits) if (pending.get(backend) === edit) pending.delete(backend)
      for (const waiter of completing) waiter.resolve()
    } catch (error) {
      for (const waiter of completing) waiter.reject(error)
      throw error
    }
  },
  onError: (error) => log('error', 'Image backend defaults could not be saved', { error: serializeError(error) }),
})

/** Capture before debounce: these edits belong to main even after a window closes. */
export function saveImageBackendDefaults(backend: CloudBackendId, model: string, params: Record<string, unknown>): Promise<void> {
  pending.set(backend, { model, params: structuredClone(params) })
  const saved = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }))
  writer.schedule()
  return saved
}
export function drainBackendDefaults(): Promise<void> { return writer.drain() }
