import type { DrawThingsModelParams } from '../../../shared/types'
import { singleLine } from '../../../shared/textCleanup'

// The one answer to "what parameters does a Draw Things model generate with".
// Two surfaces build these — the column's form and Advanced Prompting's batch
// — and each had grown its own copy of the precedence and the gates, already
// divergent (the column enqueued seed 0, the modal did not; the modal skipped
// the negative-prompt cleanup the column ran). Main re-gates both, so the
// drift was latent rather than live; this is the shared home that keeps it so.

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
 * The configured fallbacks, with the pre-load placeholder values in ONE place.
 * The literals apply only while settings have not arrived; every populated
 * config carries all four numbers (config seeding materializes defaults).
 */
export function dtFallbacksFromSettings(settings: Record<string, unknown> | null): DtFallbackParams {
  const defaults = (
    (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
      ?.default_params as Record<string, unknown> | undefined
  ) ?? {}
  return {
    width: (defaults.fallback_width as number | undefined) ?? 1024,
    height: (defaults.fallback_height as number | undefined) ?? 1024,
    steps: (defaults.fallback_steps as number | undefined) ?? 4,
    guidance: (defaults.fallback_guidance as number | undefined) ?? 1,
    seed: defaults.seed == null ? '' : String(defaults.seed),
    negativePrompt: (defaults.fallback_negative_prompt as string | undefined) ?? '',
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
 * a seed rides along only when it parses to a positive integer (0 and blanks
 * mean "random", matching main's own guard), and the negative prompt is
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
  if (Number.isFinite(parsedSeed) && parsedSeed > 0) task.seed = parsedSeed
  const cleanedNegative = singleLine(params.negativePrompt ?? '')
  if (cleanedNegative) task.negativePrompt = cleanedNegative
  return task
}
