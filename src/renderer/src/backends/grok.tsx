import { GROK_QUALITY_VALUES } from '../../../shared/models'
import type { GrokAspectRatio, GrokModelDef, GrokQuality, GrokResolution } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'
import { useI18n } from '../i18n/I18nContext'
import { optionLabel } from '../i18n/optionLabels'

export type GrokParams = {
  aspectRatio: GrokAspectRatio
  resolution: GrokResolution
  quality: GrokQuality
}

// The ratio falls to 1:1, the app's default, and the resolution to 1k, xAI's,
// not to a list's first entry: auto comes first in the ratio list.
function resolveParams(saved: Record<string, unknown>, modelDef: GrokModelDef): GrokParams {
  const aspectRatio = typeof saved.aspectRatio === 'string' && modelDef.aspectRatios.some((item) => item.value === saved.aspectRatio)
    ? saved.aspectRatio as GrokAspectRatio
    : '1:1'
  const resolution = typeof saved.resolution === 'string' && modelDef.resolutions.some((item) => item.value === saved.resolution)
    ? saved.resolution as GrokResolution
    : '1k'
  // Held even for a model that declares no qualities — the field is hidden and never
  // enqueued there, but switching back to 2.0 should restore the user's choice rather
  // than reset it (the flux steps/guidance rule). The fallback is `auto`, the API's
  // own default.
  const quality = typeof saved.quality === 'string' && (modelDef.qualities ?? GROK_QUALITY_VALUES).some((item) => item.value === saved.quality)
    ? saved.quality as GrokQuality
    : 'auto'
  return { aspectRatio, resolution, quality }
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<GrokParams, GrokModelDef>): React.JSX.Element {
  const { t } = useI18n()
  return (
    <>
      <div className="setting-row">
        <label>{t('backend.aspect')}</label>
        <select value={params.aspectRatio} onChange={(e) => onChange({ ...params, aspectRatio: e.target.value as GrokAspectRatio })}>
          {modelDef.aspectRatios.map((ar) => (
            <option key={ar.value} value={ar.value}>{optionLabel(t, ar.value)}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>{t('backend.size')}</label>
        <select value={params.resolution} onChange={(e) => onChange({ ...params, resolution: e.target.value as GrokResolution })}>
          {modelDef.resolutions.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      {modelDef.qualities && (
        <div className="setting-row">
          <label>{t('backend.quality')}</label>
          <select value={params.quality} onChange={(e) => onChange({ ...params, quality: e.target.value as GrokQuality })}>
            {modelDef.qualities.map((q) => (
              <option key={q.value} value={q.value}>{optionLabel(t, q.value)}</option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}

export const grokBackend: BackendParamModel<GrokParams, GrokModelDef> = {
  defaults: () => ({
    aspectRatio: '1:1',
    resolution: '1k',
    quality: 'auto',
  }),

  clampToModel: (params, modelDef) => resolveParams(params, modelDef),
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params, modelDef) => {
    const result: Record<string, unknown> = {
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
    }
    // grok-imagine-image carries its quality in the model id, so sending the field
    // there would be a second, contradictory way to say the same thing.
    if (modelDef.qualities) result.quality = params.quality
    return result
  },

  Controls,
}
