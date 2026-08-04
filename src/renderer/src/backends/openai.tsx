import {
  OPENAI_GPT2_MAX_EDGE,
  OPENAI_GPT2_MIN_EDGE,
  OPENAI_GPT2_SIZE_STEP,
  OPENAI_OUTPUT_FORMAT_LABELS,
  type OpenAIBackground,
  type OpenAIModeration,
  type OpenAIModelDef,
  type OpenAIOutputFormat,
  type OpenAIQuality,
  type SizePreset,
} from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'

const CUSTOM_OPENAI_SIZE = 'custom'

export type OpenAIParams = {
  width: number
  height: number
  moderation: OpenAIModeration
  quality: OpenAIQuality
  outputFormat: OpenAIOutputFormat
  background: OpenAIBackground
}

export function normalizeOpenAiDimension(value: number): number {
  if (!Number.isFinite(value)) return OPENAI_GPT2_MIN_EDGE
  const rounded = Math.round(value / OPENAI_GPT2_SIZE_STEP) * OPENAI_GPT2_SIZE_STEP
  return Math.max(OPENAI_GPT2_MIN_EDGE, Math.min(OPENAI_GPT2_MAX_EDGE, rounded))
}

export function resolveOpenAiSize(modelDef: OpenAIModelDef, width: unknown, height: unknown): { width: number; height: number } {
  const fallback = modelDef.sizes[0] ?? { label: '1024×1024', width: 1024, height: 1024 }
  const matchingPreset = typeof width === 'number' && typeof height === 'number'
    ? modelDef.sizes.find((size) => size.width === width && size.height === height)
    : null

  if (!modelDef.supportsCustomSizes) {
    const next = matchingPreset ?? fallback
    return { width: next.width, height: next.height }
  }

  if (typeof width !== 'number' || typeof height !== 'number') {
    return { width: fallback.width, height: fallback.height }
  }

  return {
    width: normalizeOpenAiDimension(width),
    height: normalizeOpenAiDimension(height),
  }
}

function findPresetValue(sizes: SizePreset[], width: number, height: number): string | null {
  const preset = sizes.find((size) => size.width === width && size.height === height)
  return preset ? `${preset.width}x${preset.height}` : null
}

function resolveModeration(modelDef: OpenAIModelDef, value: unknown): OpenAIModeration {
  return typeof value === 'string' && modelDef.moderations.includes(value as OpenAIModeration)
    ? value as OpenAIModeration
    : (modelDef.moderations.find((item) => item === 'auto') ?? modelDef.moderations[0])
}

function resolveQuality(modelDef: OpenAIModelDef, value: unknown): OpenAIQuality {
  return typeof value === 'string' && modelDef.qualities.includes(value as OpenAIQuality)
    ? value as OpenAIQuality
    : (modelDef.qualities.find((item) => item === 'auto') ?? modelDef.qualities[0])
}

function resolveOutputFormat(modelDef: OpenAIModelDef, value: unknown): OpenAIOutputFormat {
  return typeof value === 'string' && modelDef.outputFormats.includes(value as OpenAIOutputFormat)
    ? value as OpenAIOutputFormat
    : (modelDef.outputFormats.find((item) => item === 'png') ?? modelDef.outputFormats[0])
}

function resolveBackground(modelDef: OpenAIModelDef, value: unknown): OpenAIBackground {
  return typeof value === 'string' && modelDef.backgrounds.includes(value as OpenAIBackground)
    ? value as OpenAIBackground
    : (modelDef.backgrounds.find((item) => item === 'opaque') ?? modelDef.backgrounds[0])
}

function resolveParams(saved: Record<string, unknown>, modelDef: OpenAIModelDef): OpenAIParams {
  const size = resolveOpenAiSize(modelDef, saved.width, saved.height)
  return {
    width: size.width,
    height: size.height,
    moderation: resolveModeration(modelDef, saved.moderation),
    quality: resolveQuality(modelDef, saved.quality),
    outputFormat: resolveOutputFormat(modelDef, saved.outputFormat),
    background: resolveBackground(modelDef, saved.background),
  }
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<OpenAIParams, OpenAIModelDef>): React.JSX.Element {
  const sizeValue = findPresetValue(modelDef.sizes, params.width, params.height)
    ?? (modelDef.supportsCustomSizes
      ? CUSTOM_OPENAI_SIZE
      : `${modelDef.sizes[0]?.width ?? 1024}x${modelDef.sizes[0]?.height ?? 1024}`)

  const handleSizeChange = (value: string): void => {
    if (value === CUSTOM_OPENAI_SIZE) return
    const preset = modelDef.sizes.find((size) => `${size.width}x${size.height}` === value)
    if (!preset) return
    onChange({ ...params, width: preset.width, height: preset.height })
  }

  return (
    <>
      <div className="setting-row">
        <label>size</label>
        <select value={sizeValue} onChange={(e) => handleSizeChange(e.target.value)}>
          {modelDef.sizes.map((size) => (
            <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>{size.label}</option>
          ))}
          {modelDef.supportsCustomSizes && (
            <option value={CUSTOM_OPENAI_SIZE}>Custom width/height</option>
          )}
        </select>
      </div>
      {modelDef.supportsCustomSizes && (
        <>
          <div className="setting-row">
            <label>width</label>
            <input
              type="number"
              min={OPENAI_GPT2_MIN_EDGE}
              max={OPENAI_GPT2_MAX_EDGE}
              step={OPENAI_GPT2_SIZE_STEP}
              value={params.width}
              onChange={(e) => onChange({ ...params, width: normalizeOpenAiDimension(Number.parseInt(e.target.value, 10)) })}
            />
          </div>
          <div className="setting-row">
            <label>height</label>
            <input
              type="number"
              min={OPENAI_GPT2_MIN_EDGE}
              max={OPENAI_GPT2_MAX_EDGE}
              step={OPENAI_GPT2_SIZE_STEP}
              value={params.height}
              onChange={(e) => onChange({ ...params, height: normalizeOpenAiDimension(Number.parseInt(e.target.value, 10)) })}
            />
          </div>
        </>
      )}
      <div className="setting-row">
        <label>moderation</label>
        <select value={params.moderation} onChange={(e) => onChange({ ...params, moderation: e.target.value as OpenAIModeration })}>
          {modelDef.moderations.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>quality</label>
        <select value={params.quality} onChange={(e) => onChange({ ...params, quality: e.target.value as OpenAIQuality })}>
          {modelDef.qualities.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>format</label>
        <select value={params.outputFormat} onChange={(e) => onChange({ ...params, outputFormat: e.target.value as OpenAIOutputFormat })}>
          {modelDef.outputFormats.map((fmt) => (
            <option key={fmt} value={fmt}>{OPENAI_OUTPUT_FORMAT_LABELS[fmt]}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>background</label>
        <select value={params.background} onChange={(e) => onChange({ ...params, background: e.target.value as OpenAIBackground })}>
          {modelDef.backgrounds.map((bg) => (
            <option key={bg} value={bg}>{bg.charAt(0).toUpperCase() + bg.slice(1)}</option>
          ))}
        </select>
      </div>
    </>
  )
}

export const openaiBackend: BackendParamModel<OpenAIParams, OpenAIModelDef> = {
  defaults: () => ({
    width: 1024,
    height: 1024,
    moderation: 'auto',
    quality: 'auto',
    outputFormat: 'png',
    background: 'opaque',
  }),

  // Every enum field is membership-or-default and the size snaps through
  // resolveOpenAiSize, so a model switch and a saved record resolve identically.
  clampToModel: (params, modelDef) => resolveParams(params, modelDef),
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params) => ({
    width: params.width,
    height: params.height,
    moderation: params.moderation,
    quality: params.quality,
    outputFormat: params.outputFormat,
    background: params.background,
  }),

  Controls,
}
