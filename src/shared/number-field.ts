import { DRAWTHINGS_SIZE_STEP, OPENAI_COMPRESSION_RANGE, OPENAI_IMAGE_MAX_EDGE, OPENAI_IMAGE_MIN_EDGE, OPENAI_IMAGE_SIZE_STEP } from './models'
import { MAX_DRAFT_ITERATIONS } from './session-draft'
import { findModel } from './ai-models'
import type { BackendId, CloudBackendId } from './types'

/** What a number field accepts. A field and the owner of its value check the
 *  same rule, so the owner never has to correct what the field let through. */
export interface NumberRule {
  min: number
  max?: number
  /** Only whole numbers. Implied by `multipleOf`. */
  whole?: boolean
  /** Only whole multiples of this step. */
  multipleOf?: number
}

/** Whether `value` is a number the rule accepts. */
export function meetsNumberRule(value: unknown, { min, max, whole, multipleOf }: NumberRule): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if ((whole || multipleOf !== undefined) && !Number.isSafeInteger(value)) return false
  if (multipleOf !== undefined && value % multipleOf !== 0) return false
  return value >= min && (max === undefined || value <= max)
}

/** The number a field's whole text holds, or null when the rule does not
 *  accept it. parseInt or parseFloat alone would read "2.5" as 2 or "12px" as
 *  12, and the field would then use a number the user did not type. */
export function parseNumberText(text: string, rule: NumberRule): number | null {
  const value = text.trim()
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) return null
  const number = Number(value)
  return meetsNumberRule(number, rule) ? number : null
}

export const AUTO_PREVIEW_SECONDS_RULE: NumberRule = { min: 0, whole: true }
export const TIMEOUT_SECONDS_RULE: NumberRule = { min: 1, whole: true }
/** What a stored timeout holds: the whole seconds its field accepts, in milliseconds. */
export const TIMEOUT_MS_RULE: NumberRule = { min: 1000, multipleOf: 1000 }

// How many requests each cloud column may run at once.
export const CONCURRENCY_RULES: Record<CloudBackendId, NumberRule> = {
  openai: { min: 1, max: 10, whole: true },
  nanobanana: { min: 1, max: 10, whole: true },
  grok: { min: 1, max: 10, whole: true },
  flux: { min: 1, max: 24, whole: true },
}

// The CLI refuses a size that is not a multiple of 64. Steps and guidance have
// only the floor the CLI needs: Draw Things owns its own limits.
export const DRAW_THINGS_DIMENSION_RULE: NumberRule = { min: DRAWTHINGS_SIZE_STEP, multipleOf: DRAWTHINGS_SIZE_STEP }
export const DRAW_THINGS_STEPS_RULE: NumberRule = { min: 1, whole: true }
export const DRAW_THINGS_GUIDANCE_RULE: NumberRule = { min: 0 }

// OpenAI's own pixel-count and aspect limits are checked when the request is made.
export const OPENAI_DIMENSION_RULE: NumberRule = { min: OPENAI_IMAGE_MIN_EDGE, max: OPENAI_IMAGE_MAX_EDGE, multipleOf: OPENAI_IMAGE_SIZE_STEP }
export const OPENAI_COMPRESSION_RULE: NumberRule = { min: OPENAI_COMPRESSION_RANGE.min, max: OPENAI_COMPRESSION_RANGE.max, whole: true }

export const ADVANCED_ITERATIONS_RULE: NumberRule = { min: 1, max: MAX_DRAFT_ITERATIONS, whole: true }

/** A model row's declared range as a rule. */
export function rangeRule(range: { min: number; max: number }, whole: boolean): NumberRule {
  return { min: range.min, max: range.max, whole }
}

/** Whether a Draw Things parameter set holds only numbers its fields accept. */
export function meetsDrawThingsNumberRules(params: { width: unknown; height: unknown; steps: unknown; guidance: unknown }): boolean {
  return meetsNumberRule(params.width, DRAW_THINGS_DIMENSION_RULE)
    && meetsNumberRule(params.height, DRAW_THINGS_DIMENSION_RULE)
    && meetsNumberRule(params.steps, DRAW_THINGS_STEPS_RULE)
    && meetsNumberRule(params.guidance, DRAW_THINGS_GUIDANCE_RULE)
}

/** Whether each number a new task carries is one the column's field for it
 *  accepts. A field the task leaves out is the provider's or the CLI's to
 *  default; a model the list does not hold sends the plain request. */
export function meetsTaskNumberRules(backend: BackendId, model: string, params: Record<string, unknown>): boolean {
  const meets = (key: string, rule: NumberRule): boolean => params[key] === undefined || meetsNumberRule(params[key], rule)
  if (backend === 'drawthings') {
    return meets('width', DRAW_THINGS_DIMENSION_RULE) && meets('height', DRAW_THINGS_DIMENSION_RULE)
      && meets('steps', DRAW_THINGS_STEPS_RULE) && meets('guidance', DRAW_THINGS_GUIDANCE_RULE)
  }
  if (backend === 'openai') {
    if (!findModel('openai', model)) return true
    return meets('width', OPENAI_DIMENSION_RULE) && meets('height', OPENAI_DIMENSION_RULE) && meets('outputCompression', OPENAI_COMPRESSION_RULE)
  }
  if (backend === 'flux') {
    const row = findModel('flux', model)
    return (!row?.stepsRange || meets('steps', rangeRule(row.stepsRange, true)))
      && (!row?.guidanceRange || meets('guidance', rangeRule(row.guidanceRange, false)))
  }
  return true
}
