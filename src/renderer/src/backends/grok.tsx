import { GROK_QUALITY_VALUES } from '../../../shared/models'
import type { GrokAspectRatio, GrokModelDef, GrokQuality, GrokResolution } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'

export type GrokParams = {
  aspectRatio: GrokAspectRatio
  resolution: GrokResolution
  quality: GrokQuality
}

function resolveParams(saved: Record<string, unknown>, modelDef: GrokModelDef): GrokParams {
  const aspectRatio = typeof saved.aspectRatio === 'string' && modelDef.aspectRatios.some((item) => item.value === saved.aspectRatio)
    ? saved.aspectRatio as GrokAspectRatio
    : (modelDef.aspectRatios[0]?.value ?? '1:1')
  const resolution = typeof saved.resolution === 'string' && modelDef.resolutions.some((item) => item.value === saved.resolution)
    ? saved.resolution as GrokResolution
    : (modelDef.resolutions[0]?.value ?? '1k')
  // Held even for a model that declares no qualities — the field is hidden and never
  // enqueued there, but switching back to 2.0 should restore the user's choice rather
  // than reset it (the flux steps/guidance rule).
  //
  // The fallback is NOT the list's first entry, unlike the two above: `medium` is the API's
  // own default and index 0 is `low`, so clamping an unreadable saved value positionally
  // would silently downgrade output instead of restoring the shipped state.
  const quality = typeof saved.quality === 'string' && (modelDef.qualities ?? GROK_QUALITY_VALUES).some((item) => item.value === saved.quality)
    ? saved.quality as GrokQuality
    : 'medium'
  return { aspectRatio, resolution, quality }
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<GrokParams, GrokModelDef>): React.JSX.Element {
  return (
    <>
      <div className="setting-row">
        <label>aspect</label>
        <select value={params.aspectRatio} onChange={(e) => onChange({ ...params, aspectRatio: e.target.value as GrokAspectRatio })}>
          {modelDef.aspectRatios.map((ar) => (
            <option key={ar.value} value={ar.value}>{ar.label}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>size</label>
        <select value={params.resolution} onChange={(e) => onChange({ ...params, resolution: e.target.value as GrokResolution })}>
          {modelDef.resolutions.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      {modelDef.qualities && (
        <div className="setting-row">
          <label>quality</label>
          <select value={params.quality} onChange={(e) => onChange({ ...params, quality: e.target.value as GrokQuality })}>
            {modelDef.qualities.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
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
    quality: 'medium',
  }),

  clampToModel: (params, modelDef) => resolveParams(params, modelDef),
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params, modelDef) => {
    const result: Record<string, unknown> = {
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
    }
    // 1.x carries its quality in the model id, so sending the field there would be a
    // second, contradictory way to say the same thing.
    if (modelDef.qualities) result.quality = params.quality
    return result
  },

  Controls,
}
