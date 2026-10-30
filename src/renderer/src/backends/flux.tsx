import { useId } from 'react'
import { IMAGE_SEED_LIMITS, resolveImageSeed } from '../../../shared/image-seed'
import { OPENAI_OUTPUT_FORMAT_LABELS, type FluxModelDef, type FluxOutputFormat } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'
import { useI18n } from '../i18n/I18nContext'
import { optionLabel, sizePresetLabel } from '../i18n/optionLabels'
import { IMAGE_DEFAULT_PARAMS } from '../../../shared/image-backend-defaults'
import { parseNumberText, rangeRule, type NumberRule } from '../../../shared/number-field'
import { NumberSettingRow } from '../components/NumberInput'

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
  /** Steps and guidance hold their text as typed; only a value in the model's
   *  range reaches a request or the column's saved choices. */
  steps: string
  guidance: string
  /** Raw seed field text; validated in full before admission. */
  seed: string
  /** FLUX 3: a ratio and a resolution level in place of width and height. */
  aspectRatio: string
  resolution: string
}

// A range-bounded param (steps, guidance) exists only for models that declare
// the range — Flex alone today. No range means the param does not apply to this
// model, which is why an absent one resolves to undefined rather than to a
// number. backend-params.json refuses a saved number outside the saved model's
// range, so one is shown as it is; the field says so if the column's model
// takes another range.
function resolveRangedParam(
  range: { min: number; max: number; default: number } | undefined,
  saved: unknown
): number | undefined {
  if (!range) return undefined
  return typeof saved === 'number' ? saved : range.default
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

const stepsRule = (range: { min: number; max: number }): NumberRule => rangeRule(range, true)
const guidanceRule = (range: { min: number; max: number }): NumberRule => rangeRule(range, false)

function Controls({ params, modelDef, onChange }: BackendControlsProps<FluxParams, FluxModelDef>): React.JSX.Element {
  const { t } = useI18n()
  const fieldId = useId()
  const seedValid = resolveImageSeed(params.seed, 'flux').valid
  if (modelDef.aspectRatios) {
    return (
      <>
        <div className="setting-row">
          <label htmlFor={`${fieldId}-aspect`}>{t('backend.aspect')}</label>
          <select id={`${fieldId}-aspect`} value={params.aspectRatio} onChange={(e) => onChange({ ...params, aspectRatio: e.target.value })}>
            {modelDef.aspectRatios.map((ar) => (
              <option key={ar.value} value={ar.value}>{optionLabel(t, ar.value)}</option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <label htmlFor={`${fieldId}-size`}>{t('backend.size')}</label>
          <select id={`${fieldId}-size`} value={params.resolution} onChange={(e) => onChange({ ...params, resolution: e.target.value })}>
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
        <label htmlFor={`${fieldId}-size`}>{t('backend.size')}</label>
        <select id={`${fieldId}-size`} value={params.sizeIdx} onChange={(e) => onChange({ ...params, sizeIdx: Number.parseInt(e.target.value, 10) })}>
          {(modelDef.sizes ?? []).map((s, i) => (
            <option key={i} value={i}>{sizePresetLabel(t, s)}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label htmlFor={`${fieldId}-format`}>{t('backend.format')}</label>
        <select id={`${fieldId}-format`} value={params.outputFormat} onChange={(e) => onChange({ ...params, outputFormat: e.target.value as FluxOutputFormat })}>
          {(modelDef.outputFormats ?? []).map((fmt) => (
            <option key={fmt} value={fmt}>{OPENAI_OUTPUT_FORMAT_LABELS[fmt]}</option>
          ))}
        </select>
      </div>
      {modelDef.stepsRange && (
        <NumberSettingRow id={`${fieldId}-steps`} label={t('backend.steps')} rule={stepsRule(modelDef.stepsRange)} text={params.steps} onText={(steps) => onChange({ ...params, steps })} />
      )}
      {modelDef.guidanceRange && (
        <NumberSettingRow id={`${fieldId}-guidance`} label={t('backend.guidance')} rule={guidanceRule(modelDef.guidanceRange)} text={params.guidance} onText={(guidance) => onChange({ ...params, guidance })} />
      )}
      <div className="setting-row">
        <label htmlFor={`${fieldId}-seed`}>{t('backend.seed')}</label>
        <input id={`${fieldId}-seed`} type="text" aria-invalid={!seedValid} aria-describedby={!seedValid ? `${fieldId}-seed-error` : undefined} value={params.seed} onChange={(e) => onChange({ ...params, seed: e.target.value })} placeholder={t('backend.seedPlaceholder')} />
      </div>
      {!seedValid && <div id={`${fieldId}-seed-error`} className="drawthings-save-error" role="alert">{t('backend.invalidSeed', IMAGE_SEED_LIMITS.flux)}</div>}
    </>
  )
}

export const fluxBackend: BackendParamModel<FluxParams, FluxModelDef> = {
  defaults: () => ({
    sizeIdx: 0,
    outputFormat: 'png',
    steps: String(FALLBACK_STEPS),
    guidance: String(FALLBACK_GUIDANCE),
    seed: '',
    ...IMAGE_DEFAULT_PARAMS.flux,
  }),

  // Model switch: an index off the new model's shorter ladder falls to the
  // first size. Steps and guidance keep what was typed; the fields show an
  // error when the new model's range does not take it, and the column waits.
  clampToModel: (params, modelDef) => ({
    sizeIdx: modelDef.sizes?.[params.sizeIdx] ? params.sizeIdx : 0,
    outputFormat: outputFormat(params, modelDef),
    steps: params.steps,
    guidance: params.guidance,
    seed: params.seed,
    ...ratioAndResolution(params, modelDef),
  }),

  fromSaved: (saved, modelDef) => {
    const sizeIdx = (modelDef.sizes ?? []).findIndex(
      (size) => size.width === saved.width && size.height === saved.height
    )
    return {
      sizeIdx: sizeIdx >= 0 ? sizeIdx : 0,
      outputFormat: outputFormat(saved, modelDef),
      steps: String(resolveRangedParam(modelDef.stepsRange, saved.steps) ?? FALLBACK_STEPS),
      guidance: String(resolveRangedParam(modelDef.guidanceRange, saved.guidance) ?? FALLBACK_GUIDANCE),
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
    if (modelDef.stepsRange) {
      const steps = parseNumberText(params.steps, stepsRule(modelDef.stepsRange))
      if (steps === null) return null
      result.steps = steps
    }
    if (modelDef.guidanceRange) {
      const guidance = parseNumberText(params.guidance, guidanceRule(modelDef.guidanceRange))
      if (guidance === null) return null
      result.guidance = guidance
    }
    const seed = resolveImageSeed(params.seed, 'flux')
    if (!seed.valid) return null
    result.seed = seed.seed
    return result
  },

  Controls,
}
