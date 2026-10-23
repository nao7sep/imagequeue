import { useId } from 'react'
import type { NanoBananaModelDef } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'
import { useI18n } from '../i18n/I18nContext'
import { IMAGE_DEFAULT_PARAMS } from '../../../shared/image-backend-defaults'

export type NanoBananaParams = {
  aspectRatio: string
  imageSize: string
  thinking: string
}

function listed(values: readonly string[], value: unknown, fallback: string): string {
  return typeof value === 'string' && values.includes(value) ? value : fallback
}

// The ratio and size fall to 1:1 and 1K, the app's and Google's defaults, when
// the row takes them, else to the row's first; thinking falls to the row's default.
function resolveParams(saved: Record<string, unknown>, modelDef: NanoBananaModelDef): NanoBananaParams {
  const ratios = modelDef.aspectRatios.map((item) => item.value)
  const sizes = modelDef.imageSizes.map((item) => item.value)
  return {
    aspectRatio: listed(ratios, saved.aspectRatio, listed(ratios, '1:1', ratios[0]!)),
    imageSize: listed(sizes, saved.imageSize, listed(sizes, '1K', sizes[0]!)),
    thinking: listed(modelDef.thinking, saved.thinking, modelDef.defaultThinking),
  }
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<NanoBananaParams, NanoBananaModelDef>): React.JSX.Element {
  const { t } = useI18n()
  const fieldId = useId()
  return (
    <>
      <div className="setting-row">
        <label htmlFor={`${fieldId}-aspect`}>{t('backend.aspect')}</label>
        <select id={`${fieldId}-aspect`} value={params.aspectRatio} onChange={(e) => onChange({ ...params, aspectRatio: e.target.value })}>
          {modelDef.aspectRatios.map((ar) => (
            <option key={ar.value} value={ar.value}>{ar.label}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label htmlFor={`${fieldId}-size`}>{t('backend.size')}</label>
        <select id={`${fieldId}-size`} value={params.imageSize} onChange={(e) => onChange({ ...params, imageSize: e.target.value })}>
          {modelDef.imageSizes.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      {/* The provider's own words, as the text settings show them. */}
      <div className="setting-row">
        <label htmlFor={`${fieldId}-thinking`}>{t('settings.thinking')}</label>
        <select id={`${fieldId}-thinking`} value={params.thinking} onChange={(e) => onChange({ ...params, thinking: e.target.value })}>
          {modelDef.thinking.map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </div>
    </>
  )
}

export const nanoBananaBackend: BackendParamModel<NanoBananaParams, NanoBananaModelDef> = {
  defaults: () => ({ ...IMAGE_DEFAULT_PARAMS.nanobanana }),

  // Models take different thinking levels, so a model switch resets thinking to
  // the new model's default; the ratio and size keep a value the new model takes.
  clampToModel: (params, modelDef) => ({ ...resolveParams(params, modelDef), thinking: modelDef.defaultThinking }),
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params) => ({ aspectRatio: params.aspectRatio, imageSize: params.imageSize, thinking: params.thinking }),

  Controls,
}
