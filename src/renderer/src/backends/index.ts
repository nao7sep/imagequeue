import type { CloudBackendId } from '../../../shared/types'
import type { ModelDef } from '../../../shared/models'
import type { BackendParamModel } from './types'
import { openaiBackend } from './openai'
import { imagenBackend } from './imagen'
import { nanoBananaBackend } from './nanobanana'
import { grokBackend } from './grok'
import { fluxBackend } from './flux'

export type { BackendParamModel } from './types'
export { openaiBackend, type OpenAIParams } from './openai'
export { imagenBackend, type ImagenParams } from './imagen'
export { nanoBananaBackend, type NanoBananaParams } from './nanobanana'
export { grokBackend, type GrokParams } from './grok'
export { fluxBackend, type FluxParams } from './flux'

// The type-erased view a generic consumer (the column) holds. The casts below
// are the ONLY place the per-backend typing is erased; inside each descriptor
// file everything is fully typed against its own params and ModelDef subtype.
export type AnyBackendParamModel = BackendParamModel<Record<string, unknown>, ModelDef>

export const CLOUD_BACKENDS: Record<CloudBackendId, AnyBackendParamModel> = {
  openai: openaiBackend as unknown as AnyBackendParamModel,
  imagen: imagenBackend as unknown as AnyBackendParamModel,
  nanobanana: nanoBananaBackend as unknown as AnyBackendParamModel,
  grok: grokBackend as unknown as AnyBackendParamModel,
  flux: fluxBackend as unknown as AnyBackendParamModel,
}
