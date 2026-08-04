import {
  IMAGEN_PERSON_GENERATION_LABELS,
  type ImagenModelDef,
  type ImagenPersonGeneration,
} from '../../../shared/models'
import type { BackendControlsProps, BackendParamModel } from './types'

export type ImagenParams = {
  aspectRatio: string
  imageSize: string
  personGeneration: ImagenPersonGeneration
}

function resolveParams(saved: Record<string, unknown>, modelDef: ImagenModelDef): ImagenParams {
  const aspectRatio = typeof saved.aspectRatio === 'string' && modelDef.aspectRatios.some((item) => item.value === saved.aspectRatio)
    ? saved.aspectRatio
    : (modelDef.aspectRatios[0]?.value ?? '1:1')
  const imageSize = typeof saved.imageSize === 'string' && modelDef.imageSizes.some((item) => item.value === saved.imageSize)
    ? saved.imageSize
    : (modelDef.imageSizes[0]?.value ?? '1K')
  const personGeneration = typeof saved.personGeneration === 'string' && modelDef.personGeneration.includes(saved.personGeneration as ImagenPersonGeneration)
    ? saved.personGeneration as ImagenPersonGeneration
    : (modelDef.personGeneration.find((value) => value === 'allow_all') ?? modelDef.personGeneration[0])
  return { aspectRatio, imageSize, personGeneration }
}

function Controls({ params, modelDef, onChange }: BackendControlsProps<ImagenParams, ImagenModelDef>): React.JSX.Element {
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
      {modelDef.supportsImageSize && (
        <div className="setting-row">
          <label>size</label>
          <select value={params.imageSize} onChange={(e) => onChange({ ...params, imageSize: e.target.value })}>
            {modelDef.imageSizes.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="setting-row">
        <label>persons</label>
        <select value={params.personGeneration} onChange={(e) => onChange({ ...params, personGeneration: e.target.value as ImagenPersonGeneration })}>
          {modelDef.personGeneration.map((value) => (
            <option key={value} value={value}>{IMAGEN_PERSON_GENERATION_LABELS[value]}</option>
          ))}
        </select>
      </div>
    </>
  )
}

export const imagenBackend: BackendParamModel<ImagenParams, ImagenModelDef> = {
  defaults: () => ({
    aspectRatio: '1:1',
    imageSize: '1K',
    personGeneration: 'allow_all',
  }),

  // Membership-or-default on every field, so model switch and saved-record
  // resolution are the same computation.
  clampToModel: (params, modelDef) => resolveParams(params, modelDef),
  fromSaved: (saved, modelDef) => resolveParams(saved, modelDef),

  toEnqueueParams: (params) => ({
    aspectRatio: params.aspectRatio,
    imageSize: params.imageSize,
    personGeneration: params.personGeneration,
  }),

  Controls,
}
