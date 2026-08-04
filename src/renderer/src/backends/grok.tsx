import type { GrokAspectRatio, GrokModelDef, GrokResolution } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'

export type GrokParams = {
  aspectRatio: GrokAspectRatio
  resolution: GrokResolution
}

function resolveParams(saved: Record<string, unknown>, modelDef: GrokModelDef): GrokParams {
  const aspectRatio = typeof saved.aspectRatio === 'string' && modelDef.aspectRatios.some((item) => item.value === saved.aspectRatio)
    ? saved.aspectRatio as GrokAspectRatio
    : (modelDef.aspectRatios[0]?.value ?? '1:1')
  const resolution = typeof saved.resolution === 'string' && modelDef.resolutions.some((item) => item.value === saved.resolution)
    ? saved.resolution as GrokResolution
    : (modelDef.resolutions[0]?.value ?? '1k')
  return { aspectRatio, resolution }
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
    </>
  )
}

export const grokBackend: BackendParamModel<GrokParams, GrokModelDef> = {
  defaults: () => ({
    aspectRatio: '1:1',
    resolution: '1k',
  }),

  clampToModel: (params, modelDef) => resolveParams(params, modelDef),
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params) => ({
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
  }),

  Controls,
}
