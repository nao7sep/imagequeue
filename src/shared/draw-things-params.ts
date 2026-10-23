import type { DrawThingsModelParams } from './types'
import { singleLine } from './textCleanup'
import { DRAWTHINGS_FALLBACK_PARAMS } from './image-backend-defaults'

// Parameter precedence is shared by main-owned Apply to all, the column form,
// and Advanced Prompting. Task admission captures explicit random seed intent.

export interface DtFallbackParams {
  width: number
  height: number
  steps: number
  guidance: number
  seed: string
  negativePrompt: string
}

/** A recommendation's parameter surface (subset of what resolveRecommendation
 *  returns — its fields are number | null, so null must fall through). */
export interface DtRecommendationParams {
  width?: number | null
  height?: number | null
  steps?: number | null
  guidance?: number | null
  negativePrompt?: string | null
}

/**
 * The configured fallbacks. Before settings arrive the built-in fallbacks
 * stand in; every populated effective config carries its whole fallback set.
 */
export function dtFallbacksFromSettings(settings: Record<string, unknown> | null): DtFallbackParams {
  const defaults = (
    (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
      ?.default_params as Record<string, unknown> | undefined
  ) ?? {}
  const builtIn = DRAWTHINGS_FALLBACK_PARAMS
  return {
    width: (defaults.fallback_width as number | undefined) ?? builtIn.fallback_width,
    height: (defaults.fallback_height as number | undefined) ?? builtIn.fallback_height,
    steps: (defaults.fallback_steps as number | undefined) ?? builtIn.fallback_steps,
    guidance: (defaults.fallback_guidance as number | undefined) ?? builtIn.fallback_guidance,
    seed: defaults.seed == null ? '' : String(defaults.seed),
    negativePrompt: (defaults.fallback_negative_prompt as string | undefined) ?? builtIn.fallback_negative_prompt,
  }
}

/**
 * The three-tier precedence: saved per-model params take the whole set;
 * otherwise the recommendation fills per field over the configured fallbacks.
 * Seed never comes from a recommendation — reproducing a recommended seed
 * would make every user's output identical.
 */
export function resolveDtParams(
  saved: DrawThingsModelParams | null,
  recommendation: DtRecommendationParams | null,
  fallbacks: DtFallbackParams,
): DrawThingsModelParams {
  if (saved) return { ...saved }
  return {
    width: recommendation?.width ?? fallbacks.width,
    height: recommendation?.height ?? fallbacks.height,
    steps: recommendation?.steps ?? fallbacks.steps,
    guidance: recommendation?.guidance ?? fallbacks.guidance,
    seed: fallbacks.seed,
    negativePrompt: recommendation?.negativePrompt ?? fallbacks.negativePrompt,
  }
}

/**
 * Form/model params → the task's enqueue params. One gate for both surfaces:
 * a positive integer fixes the seed; zero explicitly captures random intent
 * so later global defaults cannot change the submitted task, and the negative prompt is
 * cleaned as a scalar and dropped when empty.
 */
export function toDrawThingsTaskParams(params: DrawThingsModelParams): Record<string, unknown> {
  const task: Record<string, unknown> = {
    width: params.width,
    height: params.height,
    steps: params.steps,
    guidance: params.guidance,
  }
  const parsedSeed = typeof params.seed === 'string' && params.seed ? Number.parseInt(params.seed, 10) : NaN
  task.seed = Number.isFinite(parsedSeed) && parsedSeed > 0 ? parsedSeed : 0
  const cleanedNegative = singleLine(params.negativePrompt ?? '')
  if (cleanedNegative) task.negativePrompt = cleanedNegative
  return task
}
