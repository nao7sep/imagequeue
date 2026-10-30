import { useId } from 'react'
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
import { IMAGE_DEFAULT_PARAMS } from '../../../shared/image-backend-defaults'
import { OPENAI_COMPRESSION_RULE, OPENAI_DIMENSION_RULE, parseNumberText } from '../../../shared/number-field'
import { NumberSettingRow } from '../components/NumberInput'

const CUSTOM_OPENAI_SIZE = 'custom'

// The number fields hold their text as typed; only a value their rule accepts
// reaches a request or the column's saved choices.
export type OpenAIParams = {
  width: string
  height: string
  quality: OpenAIQuality
  outputFormat: OpenAIOutputFormat
  /** Held for every format; sent only for jpeg and webp. */
  outputCompression: string
  background: OpenAIBackground
}

export function normalizeOpenAiDimension(value: number): number {
  if (!Number.isFinite(value)) return OPENAI_IMAGE_MIN_EDGE
  const rounded = Math.round(value / OPENAI_IMAGE_SIZE_STEP) * OPENAI_IMAGE_SIZE_STEP
  return Math.max(OPENAI_IMAGE_MIN_EDGE, Math.min(OPENAI_IMAGE_MAX_EDGE, rounded))
}

// Every OpenAI row takes any size within the custom-size rule, so a saved size
// is put onto the grid rather than snapped to a preset. Saved values only: a
// typed size is kept as typed.
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

// The choices a row offers resolve against it; the number fields' text is
// any row's to keep.
function resolveChoices(params: OpenAIParams, modelDef: OpenAIModelDef): OpenAIParams {
  const background = oneOf(modelDef.backgrounds, params.background, 'auto')
  return {
    ...params,
    quality: oneOf(modelDef.qualities, params.quality, 'auto'),
    outputFormat: oneOf(formatsFor(modelDef, background), params.outputFormat, 'png'),
    background,
  }
}

function fromSaved(saved: Record<string, unknown>, modelDef: OpenAIModelDef): OpenAIParams {
  const size = resolveOpenAiSize(modelDef, saved.width, saved.height)
  return resolveChoices({
    width: String(size.width),
    height: String(size.height),
    quality: saved.quality as OpenAIQuality,
    outputFormat: saved.outputFormat as OpenAIOutputFormat,
    outputCompression: String(resolveCompression(saved.outputCompression)),
    background: saved.background as OpenAIBackground,
  }, modelDef)
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<OpenAIParams, OpenAIModelDef>): React.JSX.Element {
  const { t } = useI18n()
  const fieldId = useId()
  const sizeValue = findPresetValue(modelDef.sizes, Number(params.width), Number(params.height)) ?? CUSTOM_OPENAI_SIZE

  const handleSizeChange = (value: string): void => {
    if (value === CUSTOM_OPENAI_SIZE) return
    const preset = modelDef.sizes.find((size) => `${size.width}x${size.height}` === value)
    if (!preset) return
    onChange({ ...params, width: String(preset.width), height: String(preset.height) })
  }

  return (
    <>
      <div className="setting-row">
        <label htmlFor={`${fieldId}-size`}>{t('backend.size')}</label>
        <select id={`${fieldId}-size`} value={sizeValue} onChange={(e) => handleSizeChange(e.target.value)}>
          {modelDef.sizes.map((size) => (
            <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>{sizePresetLabel(t, size)}</option>
          ))}
          <option value={CUSTOM_OPENAI_SIZE}>{t('backend.customSize')}</option>
        </select>
      </div>
      <NumberSettingRow id={`${fieldId}-width`} label={t('backend.width')} rule={OPENAI_DIMENSION_RULE} text={params.width} onText={(width) => onChange({ ...params, width })} />
      <NumberSettingRow id={`${fieldId}-height`} label={t('backend.height')} rule={OPENAI_DIMENSION_RULE} text={params.height} onText={(height) => onChange({ ...params, height })} />
      <div className="setting-row">
        <label htmlFor={`${fieldId}-quality`}>{t('backend.quality')}</label>
        <select id={`${fieldId}-quality`} value={params.quality} onChange={(e) => onChange({ ...params, quality: e.target.value as OpenAIQuality })}>
          {modelDef.qualities.map((q) => (
            <option key={q} value={q}>{optionLabel(t, q)}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label htmlFor={`${fieldId}-background`}>{t('backend.background')}</label>
        <select id={`${fieldId}-background`} value={params.background} onChange={(e) => onChange(resolveChoices({ ...params, background: e.target.value as OpenAIBackground }, modelDef))}>
          {modelDef.backgrounds.map((bg) => (
            <option key={bg} value={bg}>{optionLabel(t, bg)}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label htmlFor={`${fieldId}-format`}>{t('backend.format')}</label>
        <select id={`${fieldId}-format`} value={params.outputFormat} onChange={(e) => onChange({ ...params, outputFormat: e.target.value as OpenAIOutputFormat })}>
          {formatsFor(modelDef, params.background).map((fmt) => (
            <option key={fmt} value={fmt}>{OPENAI_OUTPUT_FORMAT_LABELS[fmt]}</option>
          ))}
        </select>
      </div>
      {params.outputFormat !== 'png' && (
        <NumberSettingRow id={`${fieldId}-compression`} label={t('backend.compression')} rule={OPENAI_COMPRESSION_RULE} text={params.outputCompression} onText={(outputCompression) => onChange({ ...params, outputCompression })} />
      )}
    </>
  )
}

export const openaiBackend: BackendParamModel<OpenAIParams, OpenAIModelDef> = {
  defaults: () => {
    const { width, height, outputCompression, ...choices } = IMAGE_DEFAULT_PARAMS.openai
    return { ...choices, width: String(width), height: String(height), outputCompression: String(outputCompression) }
  },

  // Every enum field is membership-or-default, so a model switch keeps what
  // the new row offers; every row takes the same sizes.
  clampToModel: (params, modelDef) => resolveChoices(params, modelDef),
  fromSaved,

  toEnqueueParams: (params) => {
    const width = parseNumberText(params.width, OPENAI_DIMENSION_RULE)
    const height = parseNumberText(params.height, OPENAI_DIMENSION_RULE)
    // Compression applies to jpeg and webp only.
    const compressed = params.outputFormat !== 'png'
    const outputCompression = compressed ? parseNumberText(params.outputCompression, OPENAI_COMPRESSION_RULE) : null
    if (width === null || height === null || (compressed && outputCompression === null)) return null
    return {
      width,
      height,
      quality: params.quality,
      outputFormat: params.outputFormat,
      ...(compressed ? { outputCompression } : {}),
      background: params.background,
    }
  },

  Controls,
}
