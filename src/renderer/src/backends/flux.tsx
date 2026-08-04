import type { FluxModelDef } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'

// The UI keeps steps/guidance values even for a model that declares no range
// (the fields are hidden and never enqueued); these are the numbers a fresh
// column starts from and the fallback when a saved record carries none.
const FALLBACK_STEPS = 50
const FALLBACK_GUIDANCE = 5

export type FluxParams = {
  /** Index into the model's own size ladder (each model brings its own list). */
  sizeIdx: number
  steps: number
  guidance: number
  /** Raw seed field text; parsed (or dropped) at enqueue time. */
  seed: string
}

// A range-bounded param (steps, guidance) exists only for models that declare
// the range — Flex alone today. No range means the param does not apply to this
// model, which is why an absent one resolves to undefined rather than to a
// number: nothing outside the registry knows a sane value, and inventing one
// here is what let a stale app-level default sit in config pretending to be
// authoritative.
function resolveRangedParam(
  range: { min: number; max: number; default: number } | undefined,
  saved: unknown
): number | undefined {
  if (!range) return undefined
  if (typeof saved !== 'number') return range.default
  return Math.max(range.min, Math.min(range.max, saved))
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<FluxParams, FluxModelDef>): React.JSX.Element {
  return (
    <>
      <div className="setting-row">
        <label>size</label>
        <select value={params.sizeIdx} onChange={(e) => onChange({ ...params, sizeIdx: Number.parseInt(e.target.value, 10) })}>
          {modelDef.sizes.map((s, i) => (
            <option key={i} value={i}>{s.label}</option>
          ))}
        </select>
      </div>
      {modelDef.stepsRange && (
        <div className="setting-row">
          <label>steps</label>
          <input
            type="number"
            value={params.steps}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10) || modelDef.stepsRange!.default
              onChange({
                ...params,
                steps: Math.max(modelDef.stepsRange!.min, Math.min(modelDef.stepsRange!.max, next)),
              })
            }}
            min={modelDef.stepsRange.min}
            max={modelDef.stepsRange.max}
          />
        </div>
      )}
      {modelDef.guidanceRange && (
        <div className="setting-row">
          <label>guidance</label>
          <input
            type="number"
            value={params.guidance}
            onChange={(e) => {
              const next = Number.parseFloat(e.target.value) || modelDef.guidanceRange!.default
              onChange({
                ...params,
                guidance: Math.max(modelDef.guidanceRange!.min, Math.min(modelDef.guidanceRange!.max, next)),
              })
            }}
            min={modelDef.guidanceRange.min}
            max={modelDef.guidanceRange.max}
            step={0.5}
          />
        </div>
      )}
      <div className="setting-row">
        <label>seed</label>
        <input type="text" value={params.seed} onChange={(e) => onChange({ ...params, seed: e.target.value })} placeholder="random" />
      </div>
    </>
  )
}

export const fluxBackend: BackendParamModel<FluxParams, FluxModelDef> = {
  defaults: () => ({
    sizeIdx: 0,
    steps: FALLBACK_STEPS,
    guidance: FALLBACK_GUIDANCE,
    seed: '',
  }),

  // Model switch: an index off the new model's shorter ladder falls to the
  // first size, and a ranged value the new model's range does not contain takes
  // the new range's DEFAULT — the old number was tuned for another model, so
  // clamping it to a bound would preserve a meaningless value.
  clampToModel: (params, modelDef) => ({
    sizeIdx: modelDef.sizes[params.sizeIdx] ? params.sizeIdx : 0,
    steps: modelDef.stepsRange
      ? (params.steps >= modelDef.stepsRange.min && params.steps <= modelDef.stepsRange.max
        ? params.steps
        : modelDef.stepsRange.default)
      : params.steps,
    guidance: modelDef.guidanceRange
      ? (params.guidance >= modelDef.guidanceRange.min && params.guidance <= modelDef.guidanceRange.max
        ? params.guidance
        : modelDef.guidanceRange.default)
      : params.guidance,
    seed: params.seed,
  }),

  // Saved record: unlike a model switch, an out-of-range saved number is user
  // data — clamp it to the nearest bound instead of resetting to the default.
  fromSaved: (saved, modelDef) => {
    const sizeIdx = modelDef.sizes.findIndex(
      (size) => size.width === saved.width && size.height === saved.height
    )
    return {
      sizeIdx: sizeIdx >= 0 ? sizeIdx : 0,
      steps: resolveRangedParam(modelDef.stepsRange, saved.steps) ?? FALLBACK_STEPS,
      guidance: resolveRangedParam(modelDef.guidanceRange, saved.guidance) ?? FALLBACK_GUIDANCE,
      seed: saved.seed == null ? '' : String(saved.seed),
    }
  },

  toEnqueueParams: (params, modelDef) => {
    // The ladder is the model's own, so an index carried over from a model with
    // a longer list can fall off the end; the first size is the safe floor.
    const size = modelDef.sizes[params.sizeIdx] ?? modelDef.sizes[0]
    const result: Record<string, unknown> = { width: size.width, height: size.height }
    if (modelDef.stepsRange) result.steps = params.steps
    if (modelDef.guidanceRange) result.guidance = params.guidance
    const parsedSeed = params.seed ? Number.parseInt(params.seed, 10) : NaN
    result.seed = Number.isNaN(parsedSeed) ? null : parsedSeed
    return result
  },

  Controls,
}
