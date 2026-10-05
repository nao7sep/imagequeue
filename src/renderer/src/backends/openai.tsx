import {
  OPENAI_COMPRESSION_RANGE,
  OPENAI_IMAGE_MAX_EDGE,
  OPENAI_IMAGE_MIN_EDGE,
  OPENAI_IMAGE_SIZE_STEP,
  OPENAI_OUTPUT_FORMAT_LABELS,
  OPENAI_TRANSPARENT_FORMATS,
  type OpenAIBackground,
  type OpenAIModelDef,
  type OpenAIOutputFormat,
  type OpenAIQuality,
  type SizePreset,
} from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'
import { useI18n } from '../i18n/I18nContext'
import { optionLabel, sizePresetLabel } from '../i18n/optionLabels'

const CUSTOM_OPENAI_SIZE = 'custom'

export type OpenAIParams = {
  width: number
  height: number
  quality: OpenAIQuality
  outputFormat: OpenAIOutputFormat
  /** Held for every format; sent only for jpeg and webp. */
  outputCompression: number
  background: OpenAIBackground
}

export function normalizeOpenAiDimension(value: number): number {
  if (!Number.isFinite(value)) return OPENAI_IMAGE_MIN_EDGE
  const rounded = Math.round(value / OPENAI_IMAGE_SIZE_STEP) * OPENAI_IMAGE_SIZE_STEP
  return Math.max(OPENAI_IMAGE_MIN_EDGE, Math.min(OPENAI_IMAGE_MAX_EDGE, rounded))
}

// Every OpenAI row takes any size within the custom-size rule, so a saved size
// is normalized onto the grid rather than snapped to a preset.
export function resolveOpenAiSize(modelDef: OpenAIModelDef, width: unknown, height: unknown): { width: number; height: number } {
  const fallback = modelDef.sizes[0] ?? { shape: 'square', width: 1024, height: 1024 }
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

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

/** The formats the row offers with this background: a transparent one needs png or webp. */
export function formatsFor(modelDef: OpenAIModelDef, background: OpenAIBackground): OpenAIOutputFormat[] {
  return background === 'transparent'
    ? modelDef.outputFormats.filter((format) => OPENAI_TRANSPARENT_FORMATS.includes(format))
    : modelDef.outputFormats
}

function resolveCompression(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return OPENAI_COMPRESSION_RANGE.default
  return Math.max(OPENAI_COMPRESSION_RANGE.min, Math.min(OPENAI_COMPRESSION_RANGE.max, Math.round(value)))
}

function resolveParams(saved: Record<string, unknown>, modelDef: OpenAIModelDef): OpenAIParams {
  const size = resolveOpenAiSize(modelDef, saved.width, saved.height)
  const background = oneOf(modelDef.backgrounds, saved.background, 'auto')
  return {
    width: size.width,
    height: size.height,
    quality: oneOf(modelDef.qualities, saved.quality, 'auto'),
    outputFormat: oneOf(formatsFor(modelDef, background), saved.outputFormat, 'png'),
    outputCompression: resolveCompression(saved.outputCompression),
    background,
  }
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<OpenAIParams, OpenAIModelDef>): React.JSX.Element {
  const { t } = useI18n()
  const sizeValue = findPresetValue(modelDef.sizes, params.width, params.height) ?? CUSTOM_OPENAI_SIZE

  const handleSizeChange = (value: string): void => {
    if (value === CUSTOM_OPENAI_SIZE) return
    const preset = modelDef.sizes.find((size) => `${size.width}x${size.height}` === value)
    if (!preset) return
    onChange({ ...params, width: preset.width, height: preset.height })
  }

  return (
    <>
      <div className="setting-row">
        <label>{t('backend.size')}</label>
        <select value={sizeValue} onChange={(e) => handleSizeChange(e.target.value)}>
          {modelDef.sizes.map((size) => (
            <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>{sizePresetLabel(t, size)}</option>
          ))}
          <option value={CUSTOM_OPENAI_SIZE}>{t('backend.customSize')}</option>
        </select>
      </div>
      <div className="setting-row">
        <label>{t('backend.width')}</label>
        <input
          type="number"
          min={OPENAI_IMAGE_MIN_EDGE}
          max={OPENAI_IMAGE_MAX_EDGE}
          step={OPENAI_IMAGE_SIZE_STEP}
          value={params.width}
          onChange={(e) => onChange({ ...params, width: normalizeOpenAiDimension(Number.parseInt(e.target.value, 10)) })}
        />
      </div>
      <div className="setting-row">
        <label>{t('backend.height')}</label>
        <input
          type="number"
          min={OPENAI_IMAGE_MIN_EDGE}
          max={OPENAI_IMAGE_MAX_EDGE}
          step={OPENAI_IMAGE_SIZE_STEP}
          value={params.height}
          onChange={(e) => onChange({ ...params, height: normalizeOpenAiDimension(Number.parseInt(e.target.value, 10)) })}
        />
      </div>
      <div className="setting-row">
        <label>{t('backend.quality')}</label>
        <select value={params.quality} onChange={(e) => onChange({ ...params, quality: e.target.value as OpenAIQuality })}>
          {modelDef.qualities.map((q) => (
            <option key={q} value={q}>{optionLabel(t, q)}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>{t('backend.background')}</label>
        <select value={params.background} onChange={(e) => onChange(resolveParams({ ...params, background: e.target.value }, modelDef))}>
          {modelDef.backgrounds.map((bg) => (
            <option key={bg} value={bg}>{optionLabel(t, bg)}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>{t('backend.format')}</label>
        <select value={params.outputFormat} onChange={(e) => onChange({ ...params, outputFormat: e.target.value as OpenAIOutputFormat })}>
          {formatsFor(modelDef, params.background).map((fmt) => (
            <option key={fmt} value={fmt}>{OPENAI_OUTPUT_FORMAT_LABELS[fmt]}</option>
          ))}
        </select>
      </div>
      {params.outputFormat !== 'png' && (
        <div className="setting-row">
          <label>{t('backend.compression')}</label>
          <input
            type="number"
            min={OPENAI_COMPRESSION_RANGE.min}
            max={OPENAI_COMPRESSION_RANGE.max}
            step={1}
            value={params.outputCompression}
            onChange={(e) => onChange({ ...params, outputCompression: resolveCompression(Number.parseInt(e.target.value, 10)) })}
          />
        </div>
      )}
    </>
  )
}

export const openaiBackend: BackendParamModel<OpenAIParams, OpenAIModelDef> = {
  defaults: () => ({
    width: 1024,
    height: 1024,
    quality: 'auto',
    outputFormat: 'png',
    outputCompression: OPENAI_COMPRESSION_RANGE.default,
    background: 'auto',
  }),

  // Every enum field is membership-or-default and the size snaps through
  // resolveOpenAiSize, so a model switch and a saved record resolve identically.
  clampToModel: (params, modelDef) => resolveParams(params, modelDef),
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params) => ({
    width: params.width,
    height: params.height,
    quality: params.quality,
    outputFormat: params.outputFormat,
    // Compression applies to jpeg and webp only.
    ...(params.outputFormat !== 'png' ? { outputCompression: params.outputCompression } : {}),
    background: params.background,
  }),

  Controls,
}
