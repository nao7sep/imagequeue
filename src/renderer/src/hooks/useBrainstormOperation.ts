import { useCallback, useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import type { BrainstormPhase, ElaboratedPromptRecord } from '../../../shared/types'
import type { PromptFormat, PromptLength } from '../../../shared/session-draft'

interface BrainstormOperationInput {
  compositionElaboratorId: string | null
  styleElaboratorId: string | null
  seed: string
  format: PromptFormat
  length: PromptLength
}

export interface BrainstormOperation {
  progress: { done: number; total: number; phase: BrainstormPhase } | null
  run: (count: number) => Promise<ElaboratedPromptRecord[]>
  cancel: () => void
}

/** Owns one renderer↔main brainstorm request and its progress subscription. */
export function useBrainstormOperation(input: BrainstormOperationInput): BrainstormOperation {
  const [progress, setProgress] = useState<BrainstormOperation['progress']>(null)
  const activeRequestId = useRef<string | null>(null)
  const mounted = useRef(true)

  // Strict Mode runs setup→cleanup→setup once in development. Resetting true
  // in setup keeps that probe from making the real mount look unmounted.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const run = useCallback(async (count: number): Promise<ElaboratedPromptRecord[]> => {
    if (!input.compositionElaboratorId || !input.styleElaboratorId) {
      throw new Error('Pick composition and style elaborators first.')
    }
    if (!input.seed.trim()) throw new Error('Seed prompt is empty.')

    const requestId = nanoid()
    activeRequestId.current = requestId
    const unsubscribe = window.electronAPI.onBrainstormProgress(requestId, (event) => {
      if (mounted.current) setProgress({ done: event.done, total: event.total, phase: event.phase })
    })
    if (mounted.current) setProgress({ done: 0, total: count, phase: 'facets' })

    try {
      const result = await window.electronAPI.brainstormPrompts({
        requestId,
        compositionElaboratorId: input.compositionElaboratorId,
        styleElaboratorId: input.styleElaboratorId,
        seed: input.seed,
        count,
        format: input.format,
        length: input.length,
      })
      return result.prompts
    } finally {
      unsubscribe()
      if (mounted.current) setProgress(null)
      activeRequestId.current = null
    }
  }, [input.compositionElaboratorId, input.styleElaboratorId, input.seed, input.format, input.length])

  const cancel = useCallback((): void => {
    const requestId = activeRequestId.current
    if (requestId) void window.electronAPI.cancelBrainstorm(requestId)
  }, [])

  return { progress, run, cancel }
}
