import { Builder } from 'flatbuffers'
import { GenerationConfiguration, GenerationConfigurationT } from './generated/generation-configuration'
import { LoRAT } from './generated/lo-ra'
import { SamplerType } from './generated/sampler-type'
import { ControlT } from './generated/control'
import { ControlMode } from './generated/control-mode'
import { ControlInputType } from './generated/control-input-type'
import { getSampler, getSeedMode } from './type-converters'
import { LoRAMode } from './generated/lo-ramode'
import { SeedMode } from './generated/seed-mode'

export interface LoraConfig {
  file: string
  weight: number
  mode?: LoRAMode
}

export interface ControlConfig {
  file: string
  weight: number
  guidanceStart: number
  guidanceEnd: number
  noPrompt: boolean
  globalAveragePooling: boolean
  downSamplingRate: number
  controlMode: ControlMode
  targetBlocks: string[]
  inputOverride: ControlInputType
}

export interface Config {
  width?: number
  height?: number
  id?: number
  startWidth?: number
  startHeight?: number
  seed?: number
  steps?: number
  guidanceScale?: number
  strength?: number
  model?: string
  sampler?: SamplerType | string | number
  batchCount?: number
  batchSize?: number
  hiresFix?: boolean
  hiresFixStartWidth?: number
  hiresFixStartHeight?: number
  hiresFixStrength?: number
  upscaler?: string
  imageGuidanceScale?: number
  seedMode?: SeedMode | string | number
  clipSkip?: number
  controls?: ControlConfig[]
  loras?: LoraConfig[]
  maskBlur?: number
  faceRestoration?: string
  clipWeight?: number
  negativePromptForImagePrior?: boolean
  imagePriorSteps?: number
  refinerModel?: string
  originalImageHeight?: number
  originalImageWidth?: number
  cropTop?: number
  cropLeft?: number
  targetImageHeight?: number
  targetImageWidth?: number
  aestheticScore?: number
  negativeAestheticScore?: number
  zeroNegativePrompt?: boolean
  refinerStart?: number
  negativeOriginalImageHeight?: number
  negativeOriginalImageWidth?: number
  name?: string
  fpsId?: number
  motionBucketId?: number
  condAug?: number
  startFrameCfg?: number
  numFrames?: number
  maskBlurOutset?: number
  sharpness?: number
  shift?: number
  stage2Steps?: number
  stage2Cfg?: number
  stage2Shift?: number
  tiledDecoding?: boolean
  decodingTileWidth?: number
  decodingTileHeight?: number
  decodingTileOverlap?: number
  stochasticSamplingGamma?: number
  preserveOriginalAfterInpaint?: boolean
  tiledDiffusion?: boolean
  diffusionTileWidth?: number
  diffusionTileHeight?: number
  diffusionTileOverlap?: number
  upscalerScaleFactor?: number
  t5TextEncoder?: boolean
  separateClipL?: boolean
  clipLText?: string
  separateOpenClipG?: boolean
  openClipGText?: string
  speedUpWithGuidanceEmbed?: boolean
  guidanceEmbed?: number
  resolutionDependentShift?: boolean
  teaCache?: boolean
  teaCacheEnd?: number
  teaCacheMaxSkipSteps?: number
  teaCacheStart?: number
  teaCacheThreshold?: number
  cfgZeroInitSteps?: number
  cfgZeroStar?: boolean
  separateT5?: boolean
  t5Text?: string
  causalInferenceEnabled?: boolean
  causalInference?: number
  causalInferencePad?: number
}

const drawThingsDefault: Config = {
  preserveOriginalAfterInpaint: true,
  batchCount: 1,
  seed: -1,
  batchSize: 1,
  shift: 1,
  model: 'sd_v1.5_f16.ckpt',
  height: 512,
  tiledDiffusion: false,
  diffusionTileHeight: 1024,
  diffusionTileWidth: 1024,
  diffusionTileOverlap: 128,
  sampler: SamplerType.DPMPP2MKarras,
  hiresFix: false,
  strength: 1,
  steps: 20,
  tiledDecoding: false,
  decodingTileHeight: 640,
  decodingTileWidth: 640,
  decodingTileOverlap: 128,
  loras: [],
  width: 512,
  guidanceScale: 4.5,
  maskBlur: 1.5,
  seedMode: 2,
  sharpness: 0,
  clipSkip: 1,
  controls: [],
  maskBlurOutset: 0,
  negativeOriginalImageHeight: 512,
  negativeOriginalImageWidth: 512,
  originalImageHeight: 512,
  originalImageWidth: 512,
  refinerStart: 0.85,
  targetImageHeight: 512,
  targetImageWidth: 512,
  teaCache: false,
  teaCacheEnd: -1,
  teaCacheMaxSkipSteps: 3,
  teaCacheStart: 5,
  teaCacheThreshold: 0.2,
  cfgZeroInitSteps: 0,
  cfgZeroStar: false,
  resolutionDependentShift: true,
  causalInferenceEnabled: false,
  causalInference: 3,
  causalInferencePad: 0,
  separateT5: false,
}

export function buildConfig(config: Config = {}): GenerationConfigurationT {
  const c: Config = { ...drawThingsDefault, ...config }

  const width = (c.width || c.startWidth)!
  const height = (c.height || c.startHeight)!

  return new GenerationConfigurationT(
    BigInt(c.id ?? 0),
    width / 64,
    height / 64,
    c.seed && c.seed >= 0 ? c.seed : Math.floor(Math.random() * 4294967295),
    c.steps,
    c.guidanceScale,
    c.strength,
    c.model,
    getSampler(c.sampler),
    c.batchCount,
    c.batchSize,
    c.hiresFix,
    (c.hiresFixStartWidth ?? 512) / 64,
    (c.hiresFixStartHeight ?? 512) / 64,
    c.hiresFixStrength,
    c.upscaler,
    c.imageGuidanceScale,
    getSeedMode(c.seedMode),
    c.clipSkip,
    getControlsTs(c.controls),
    getLoraTs(c.loras),
    c.maskBlur,
    c.faceRestoration,
    c.clipWeight,
    c.negativePromptForImagePrior,
    c.imagePriorSteps,
    c.refinerModel,
    c.originalImageHeight || height,
    c.originalImageWidth || width,
    c.cropTop,
    c.cropLeft,
    c.targetImageHeight || height,
    c.targetImageWidth || width,
    c.aestheticScore,
    c.negativeAestheticScore,
    c.zeroNegativePrompt,
    c.refinerStart,
    c.negativeOriginalImageHeight || height,
    c.negativeOriginalImageWidth || width,
    c.name,
    c.fpsId,
    c.motionBucketId,
    c.condAug,
    c.startFrameCfg,
    c.numFrames,
    c.maskBlurOutset,
    c.sharpness,
    c.shift,
    c.stage2Steps,
    c.stage2Cfg,
    c.stage2Shift,
    c.tiledDecoding,
    (c.decodingTileWidth ?? 512) / 64,
    (c.decodingTileHeight ?? 512) / 64,
    (c.decodingTileOverlap ?? 512) / 64,
    c.stochasticSamplingGamma,
    c.preserveOriginalAfterInpaint,
    c.tiledDiffusion,
    (c.diffusionTileWidth ?? 512) / 64,
    (c.diffusionTileHeight ?? 512) / 64,
    (c.diffusionTileOverlap ?? 512) / 64,
    c.upscalerScaleFactor,
    c.t5TextEncoder,
    c.separateClipL,
    c.clipLText,
    c.separateOpenClipG,
    c.openClipGText,
    c.speedUpWithGuidanceEmbed,
    c.guidanceEmbed,
    c.resolutionDependentShift,
    c.teaCacheStart,
    c.teaCacheEnd,
    c.teaCacheThreshold,
    c.teaCache,
    c.separateT5,
    c.t5Text,
    c.teaCacheMaxSkipSteps,
    c.causalInferenceEnabled,
    c.causalInference,
    c.causalInferencePad,
    c.cfgZeroStar,
    c.cfgZeroInitSteps,
  )
}

export function buildConfigBuffer(configT: GenerationConfigurationT): Uint8Array {
  const builder = new Builder(1024)
  GenerationConfiguration.finishGenerationConfigurationBuffer(builder, configT.pack(builder))
  return builder.asUint8Array()
}

const loraDefault: Omit<LoraConfig, 'file'> = {
  weight: 0.8,
  mode: LoRAMode.All,
}

function getLoraTs(loras?: LoraConfig[]): LoRAT[] {
  if (!loras || loras.length === 0) return []
  return loras
    .filter(l => !!l.file)
    .map(loraInput => {
      const lora = { ...loraDefault, ...loraInput }
      return new LoRAT(lora.file, lora.weight, lora.mode)
    })
}

const controlDefault: Omit<ControlConfig, 'file'> = {
  globalAveragePooling: false,
  weight: 1,
  noPrompt: false,
  guidanceStart: 0,
  guidanceEnd: 1,
  targetBlocks: [],
  controlMode: ControlMode.Balanced,
  inputOverride: ControlInputType.Inpaint,
  downSamplingRate: 1,
}

function getControlsTs(controls?: ControlConfig[]): ControlT[] {
  if (!controls || controls.length === 0) return []
  return controls
    .filter(c => !!c.file)
    .map(controlInput => {
      const control = { ...controlDefault, ...controlInput }
      return new ControlT(
        control.file,
        control.weight,
        control.guidanceStart,
        control.guidanceEnd,
        control.noPrompt,
        control.globalAveragePooling,
        control.downSamplingRate,
        control.controlMode,
        control.targetBlocks,
        control.inputOverride
      )
    })
}
