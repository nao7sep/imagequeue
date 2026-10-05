import type { Task } from '../../shared/types'
import { FLUX_MAX_PIXELS, FLUX_SIZE_STEP } from '../../shared/models'

// Pure request-shaping for the FLUX backend; flux.ts submits, polls and
// downloads. Each model has its own endpoint, named by its id. One branch per
// FLUX row of SUPPORTED_MODELS. An id with no row gets the plain request: the
// prompt alone, at that id's endpoint.

export function buildFluxBody(task: Task): Record<string, unknown> {
  const plain = { prompt: task.prompt }
  switch (task.model) {
    // Flex alone takes steps and guidance.
    case 'flux-2-flex':
      return {
        ...flux2Body(task, plain),
        ...(task.params.steps ? { steps: task.params.steps } : {}),
        ...(task.params.guidance ? { guidance: task.params.guidance } : {}),
      }
    // The other FLUX.2 models take a size and a seed.
    case 'flux-2-max':
    case 'flux-2-pro':
    case 'flux-2-klein-9b':
    case 'flux-2-klein-4b':
      return flux2Body(task, plain)
    default:
      return plain
  }
}

function flux2Body(task: Task, plain: { prompt: string }): Record<string, unknown> {
  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024
  // The same limits the size ladder is built from, so a preset can never fail here.
  if (width % FLUX_SIZE_STEP !== 0 || height % FLUX_SIZE_STEP !== 0) {
    throw new Error(`FLUX dimensions must be multiples of ${FLUX_SIZE_STEP}`)
  }
  if (width * height > FLUX_MAX_PIXELS) {
    throw new Error('FLUX dimensions exceed 4MP limit')
  }
  return {
    ...plain,
    width,
    height,
    output_format: 'png',
    ...(task.params.seed != null ? { seed: task.params.seed } : {}),
  }
}
