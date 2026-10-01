import type { TextAIBackendId } from './types'
import type { TextKind } from './ai-models'
import { modelsFor } from './ai-models'

export interface ModelListFact { fetchedAtUtc: string; ids: string[] }
export type ModelLists = Partial<Record<TextAIBackendId, ModelListFact>>

export function modelPickerGroups(provider: TextAIBackendId, kind: TextKind, fetched: readonly string[], extras: readonly string[]): {
  bundled: string[]; fetched: string[]; extras: string[]
} {
  const bundled = modelsFor(provider, kind).map((row) => row.id)
  const seen = new Set(bundled)
  const take = (ids: readonly string[]): string[] => ids.filter((id) => {
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
  return { bundled, fetched: take(fetched), extras: take(extras) }
}
