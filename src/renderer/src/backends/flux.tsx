import { OPENAI_OUTPUT_FORMAT_LABELS, type FluxModelDef, type FluxOutputFormat } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'
import { useI18n } from '../i18n/I18nContext'
import { optionLabel, sizePresetLabel } from '../i18n/optionLabels'

// The UI keeps steps/guidance values even for a model that declares no range
// (the fields are hidden and never enqueued); these are the numbers a fresh
// column starts from and the fallback when a saved record carries none.
const FALLBACK_STEPS = 50
const FALLBACK_GUIDANCE = 5

// The column holds every row kind's fields, so a switch between FLUX 3 and
// FLUX.2 and back keeps each one's choices; only the row's own reach the request.
export type FluxParams = {
  /** FLUX.2: index into the model's own size ladder (each model brings its own list). */
  sizeIdx: number
  outputFormat: FluxOutputFormat
  steps: number
  guidance: number
  /** Raw seed field text; parsed (or dropped) at enqueue time. */
  seed: string
  /** FLUX 3: a ratio and a resolution level in place of width and height. */
  aspectRatio: string
  resolution: string
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

function listed<T extends string>(values: readonly T[] | undefined, value: unknown, fallback: T): T {
  return typeof value === 'string' && (values ?? []).includes(value as T) ? value as T : fallback
}

// The ratio falls to 1:1, the app's default, and the resolution to 1k, BFL's.
function ratioAndResolution(saved: Record<string, unknown>, modelDef: FluxModelDef): Pick<FluxParams, 'aspectRatio' | 'resolution'> {
  if (!modelDef.aspectRatios) {
    return {
      aspectRatio: typeof saved.aspectRatio === 'string' ? saved.aspectRatio : '1:1',
      resolution: typeof saved.resolution === 'string' ? saved.resolution : '1k',
    }
  }
  return {
    aspectRatio: listed(modelDef.aspectRatios.map((item) => item.value), saved.aspectRatio, '1:1'),
    resolution: listed(modelDef.resolutions?.map((item) => item.value), saved.resolution, '1k'),
  }
}

function outputFormat(saved: Record<string, unknown>, modelDef: FluxModelDef): FluxOutputFormat {
  if (!modelDef.outputFormats) return listed(['png', 'jpeg', 'webp'] as const, saved.outputFormat, 'png')
  return listed(modelDef.outputFormats, saved.outputFormat, 'png')
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<FluxParams, FluxModelDef>): React.JSX.Element {
  const { t } = useI18n()
  if (modelDef.aspectRatios) {
    return (
      <>
        <div className="setting-row">
          <label>{t('backend.aspect')}</label>
          <select value={params.aspectRatio} onChange={(e) => onChange({ ...params, aspectRatio: e.target.value })}>
            {modelDef.aspectRatios.map((ar) => (
              <option key={ar.value} value={ar.value}>{optionLabel(t, ar.value)}</option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <label>{t('backend.size')}</label>
          <select value={params.resolution} onChange={(e) => onChange({ ...params, resolution: e.target.value })}>
            {(modelDef.resolutions ?? []).map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </>
    )
  }
  return (
    <>
      <div className="setting-row">
        <label>{t('backend.size')}</label>
        <select value={params.sizeIdx} onChange={(e) => onChange({ ...params, sizeIdx: Number.parseInt(e.target.value, 10) })}>
          {(modelDef.sizes ?? []).map((s, i) => (
            <option key={i} value={i}>{sizePresetLabel(t, s)}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>{t('backend.format')}</label>
        <select value={params.outputFormat} onChange={(e) => onChange({ ...params, outputFormat: e.target.value as FluxOutputFormat })}>
          {(modelDef.outputFormats ?? []).map((fmt) => (
            <option key={fmt} value={fmt}>{OPENAI_OUTPUT_FORMAT_LABELS[fmt]}</option>
          ))}
        </select>
      </div>
      {modelDef.stepsRange && (
        <div className="setting-row">
          <label>{t('backend.steps')}</label>
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
          <label>{t('backend.guidance')}</label>
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
        <label>{t('backend.seed')}</label>
        <input type="text" value={params.seed} onChange={(e) => onChange({ ...params, seed: e.target.value })} placeholder={t('backend.seedPlaceholder')} />
      </div>
    </>
  )
}

export const fluxBackend: BackendParamModel<FluxParams, FluxModelDef> = {
  defaults: () => ({
    sizeIdx: 0,
    outputFormat: 'png',
    steps: FALLBACK_STEPS,
    guidance: FALLBACK_GUIDANCE,
    seed: '',
    aspectRatio: '1:1',
    resolution: '1k',
  }),

  // Model switch: an index off the new model's shorter ladder falls to the
  // first size, and a ranged value the new model's range does not contain takes
  // the new range's DEFAULT — the old number was tuned for another model, so
  // clamping it to a bound would preserve a meaningless value.
  clampToModel: (params, modelDef) => ({
    sizeIdx: modelDef.sizes?.[params.sizeIdx] ? params.sizeIdx : 0,
    outputFormat: outputFormat(params, modelDef),
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
    ...ratioAndResolution(params, modelDef),
  }),

  // Saved record: unlike a model switch, an out-of-range saved number is user
  // data — clamp it to the nearest bound instead of resetting to the default.
  fromSaved: (saved, modelDef) => {
    const sizeIdx = (modelDef.sizes ?? []).findIndex(
      (size) => size.width === saved.width && size.height === saved.height
    )
    return {
      sizeIdx: sizeIdx >= 0 ? sizeIdx : 0,
      outputFormat: outputFormat(saved, modelDef),
      steps: resolveRangedParam(modelDef.stepsRange, saved.steps) ?? FALLBACK_STEPS,
      guidance: resolveRangedParam(modelDef.guidanceRange, saved.guidance) ?? FALLBACK_GUIDANCE,
      seed: saved.seed == null ? '' : String(saved.seed),
      ...ratioAndResolution(saved, modelDef),
    }
  },

  toEnqueueParams: (params, modelDef) => {
    if (modelDef.aspectRatios) return { aspectRatio: params.aspectRatio, resolution: params.resolution }
    // The ladder is the model's own, so an index carried over from a model with
    // a longer list can fall off the end; the first size is the safe floor.
    const sizes = modelDef.sizes ?? []
    const size = sizes[params.sizeIdx] ?? sizes[0]!
    const result: Record<string, unknown> = { width: size.width, height: size.height, outputFormat: params.outputFormat }
    if (modelDef.stepsRange) result.steps = params.steps
    if (modelDef.guidanceRange) result.guidance = params.guidance
    const parsedSeed = params.seed ? Number.parseInt(params.seed, 10) : NaN
    result.seed = Number.isNaN(parsedSeed) ? null : parsedSeed
    return result
  },

  Controls,
}
