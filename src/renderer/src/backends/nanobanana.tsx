import type { NanoBananaModelDef } from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'

export type NanoBananaParams = {
  aspectRatio: string
  imageSize: string
}

function resolveParams(saved: Record<string, unknown>, modelDef: NanoBananaModelDef): NanoBananaParams {
  const aspectRatio = typeof saved.aspectRatio === 'string' && modelDef.aspectRatios.some((item) => item.value === saved.aspectRatio)
    ? saved.aspectRatio
    : (modelDef.aspectRatios[0]?.value ?? '1:1')
  const imageSize = typeof saved.imageSize === 'string' && modelDef.imageSizes.some((item) => item.value === saved.imageSize)
    ? saved.imageSize
    : (modelDef.imageSizes[0]?.value ?? '1K')
  return { aspectRatio, imageSize }
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<NanoBananaParams, NanoBananaModelDef>): React.JSX.Element {
  if (!modelDef.supportsImageConfig) return <></>
  return (
    <>
      <div className="setting-row">
        <label>aspect</label>
        <select value={params.aspectRatio} onChange={(e) => onChange({ ...params, aspectRatio: e.target.value })}>
          {modelDef.aspectRatios.map((ar) => (
            <option key={ar.value} value={ar.value}>{ar.label}</option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label>size</label>
        <select value={params.imageSize} onChange={(e) => onChange({ ...params, imageSize: e.target.value })}>
          {modelDef.imageSizes.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
    </>
  )
}

export const nanoBananaBackend: BackendParamModel<NanoBananaParams, NanoBananaModelDef> = {
  defaults: () => ({
    aspectRatio: '1:1',
    imageSize: '1K',
  }),

  // A model without image-config support ignores these params entirely (they
  // never reach the request — see toEnqueueParams), so a switch to one leaves
  // the UI values untouched for the switch back.
  clampToModel: (params, modelDef) =>
    modelDef.supportsImageConfig ? resolveParams(params, modelDef) : params,
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params, modelDef) =>
    modelDef.supportsImageConfig
      ? { aspectRatio: params.aspectRatio, imageSize: params.imageSize }
      : {},

  Controls,
}
