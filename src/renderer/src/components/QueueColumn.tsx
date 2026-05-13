import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSelection } from '../context/SelectionContext'
import { useSettings } from '../context/SettingsContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import type { BackendId, Task, CliStatus, LocalModelInfo, RecommendedParams, DrawThingsModelParams } from '../../../shared/types'
import {
  getModelsForBackend,
  findModel,
  IMAGEN_ASPECT_RATIOS,
  IMAGEN_IMAGE_SIZES,
  GROK_ASPECT_RATIOS,
  GROK_RESOLUTIONS,
  FLUX_SIZES,
  OPENAI_SIZES_GPT2,
  OPENAI_GPT2_MAX_EDGE,
  OPENAI_GPT2_MIN_EDGE,
  OPENAI_GPT2_SIZE_STEP,
  type OpenAIModelDef,
  type ImagenModelDef,
  type NanoBananaModelDef,
  type FluxModelDef,
  type SizePreset,
  type OpenAIModeration,
  type OpenAIQuality,
  type OpenAIOutputFormat,
  type OpenAIBackground,
  type ImagenPersonGeneration,
  type GrokAspectRatio,
  type GrokResolution
} from '../../../shared/models'
import { DrawThingsModelsModal } from './DrawThingsModelsModal'
import { localModelName, sortLocalModels } from '../utils/localModels'
import './QueueColumn.css'

interface Props {
  backendId: BackendId
  label: string
  hasPrompt: boolean
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--text-muted)',
  generating: 'var(--warning)',
  completed: 'var(--success)',
  kept: 'var(--text-secondary)',
  failed: 'var(--error)',
  interrupted: 'var(--text-secondary)',
}

const CUSTOM_DRAWTHINGS_SIZE = 'custom'
const CUSTOM_OPENAI_SIZE = 'custom'
const DRAWTHINGS_SIZE_PRESETS: SizePreset[] = OPENAI_SIZES_GPT2

function buildDrawThingsParams(
  width: number,
  height: number,
  steps: number,
  guidance: number,
  seed: string,
  negativePrompt: string
): DrawThingsModelParams {
  return { width, height, steps, guidance, seed, negativePrompt }
}

function findPresetValue(sizes: SizePreset[], width: number, height: number): string | null {
  const preset = sizes.find((size) => size.width === width && size.height === height)
  return preset ? `${preset.width}x${preset.height}` : null
}

function normalizeOpenAiDimension(value: number): number {
  if (!Number.isFinite(value)) return OPENAI_GPT2_MIN_EDGE
  const rounded = Math.round(value / OPENAI_GPT2_SIZE_STEP) * OPENAI_GPT2_SIZE_STEP
  return Math.max(OPENAI_GPT2_MIN_EDGE, Math.min(OPENAI_GPT2_MAX_EDGE, rounded))
}

function resolveOpenAiSize(modelDef: OpenAIModelDef, width: unknown, height: unknown): { width: number; height: number } {
  const fallback = modelDef.sizes[0] ?? { label: '1024×1024', width: 1024, height: 1024 }
  const matchingPreset = typeof width === 'number' && typeof height === 'number'
    ? modelDef.sizes.find((size) => size.width === width && size.height === height)
    : null

  if (!modelDef.supportsCustomSizes) {
    const next = matchingPreset ?? fallback
    return { width: next.width, height: next.height }
  }

  if (typeof width !== 'number' || typeof height !== 'number') {
    return { width: fallback.width, height: fallback.height }
  }

  return {
    width: normalizeOpenAiDimension(width),
    height: normalizeOpenAiDimension(height),
  }
}

export function QueueColumn({ backendId, label, hasPrompt }: Props): React.JSX.Element {
  const { tasks, enqueue } = useQueue()
  const { selection, select, clear } = useSelection()
  const { settings, updateSettings } = useSettings()
  const { setSnapshot } = useEnqueueConfigs()
  const models = getModelsForBackend(backendId as 'openai')
  const defaultModel = models.find((m) => m.isDefault) ?? models[0]
  const [model, setModel] = useState(defaultModel?.id ?? '')
  const proprietarySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistedProprietarySnapshotRef = useRef('')

  // For openai: the full model definition, used to drive dynamic size/quality/background options
  const openaiModelDef = useMemo(
    () => backendId === 'openai' ? (models.find((m) => m.id === model) ?? models[0]) as OpenAIModelDef : null,
    [backendId, model]
  )

  // For imagen: model definition, used to know whether imageSize is supported
  const imagenModelDef = useMemo(
    () => backendId === 'imagen' ? (models.find((m) => m.id === model) ?? models[0]) as unknown as ImagenModelDef : null,
    [backendId, model]
  )

  // For nanobanana: model definition, used to know whether imageConfig is supported
  const nanoBananaModelDef = useMemo(
    () => backendId === 'nanobanana' ? (models.find((m) => m.id === model) ?? models[0]) as unknown as NanoBananaModelDef : null,
    [backendId, model]
  )

  // For flux: model definition, used to know whether steps/guidance are supported
  const fluxModelDef = useMemo(
    () => backendId === 'flux' ? (models.find((m) => m.id === model) ?? models[0]) as unknown as FluxModelDef : null,
    [backendId, model]
  )

  // Derived from context — updates automatically when settings change (no effect needed)
  const apiKey = backendId !== 'drawthings'
    ? ((settings?.image_backends as Record<string, Record<string, unknown>>)?.[backendId]?.api_key as string | undefined)
    : undefined
  const apiKeyMissing = backendId !== 'drawthings' && (!apiKey || apiKey.trim() === '')

  // OpenAI params
  const [moderation, setModeration] = useState<OpenAIModeration>('auto')
  const [quality, setQuality] = useState<OpenAIQuality>('auto')
  const [outputFormat, setOutputFormat] = useState<OpenAIOutputFormat>('png')
  const [background, setBackground] = useState<OpenAIBackground>('opaque')
  const [openaiWidth, setOpenaiWidth] = useState(1024)
  const [openaiHeight, setOpenaiHeight] = useState(1024)

  // Google Imagen params
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageSize, setImageSize] = useState('1K')
  const [personGeneration, setPersonGeneration] = useState<ImagenPersonGeneration>('allow_all')

  // Nano Banana params
  const [nanoBananaAspectRatio, setNanoBananaAspectRatio] = useState('1:1')
  const [nanoBananaImageSize, setNanoBananaImageSize] = useState('1K')

  // FLUX params
  const [fluxSizeIdx, setFluxSizeIdx] = useState(0)
  const [fluxSteps, setFluxSteps] = useState(50)
  const [fluxGuidance, setFluxGuidance] = useState(5)
  const [fluxSeed, setFluxSeed] = useState('')

  // Grok Imagine params
  const [grokAspectRatio, setGrokAspectRatio] = useState<GrokAspectRatio>('1:1')
  const [grokResolution, setGrokResolution] = useState<GrokResolution>('1k')

  // Local params
  const [localWidth, setLocalWidth] = useState(1024)
  const [localHeight, setLocalHeight] = useState(1024)
  const [localSteps, setLocalSteps] = useState(4)
  const [localGuidance, setLocalGuidance] = useState(1)
  const [localSeed, setLocalSeed] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null)
  const [downloadedModels, setDownloadedModels] = useState<LocalModelInfo[]>([])
  const [showModelsModal, setShowModelsModal] = useState(false)
  const [recommendationRevision, setRecommendationRevision] = useState(0)
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendedParams | null>(null)
  const saveParamsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDrawThingsSaveRef = useRef<{ model: string; params: DrawThingsModelParams }>({
    model: '',
    params: buildDrawThingsParams(1024, 1024, 4, 1, '', ''),
  })

  const columnTasks = tasks[backendId]
  const backendSettings = useMemo(
    () => (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.[backendId] ?? null,
    [settings, backendId]
  )
  const drawThingsFallbacks = useMemo(() => {
    const params = (
      (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
        ?.default_params as Record<string, unknown> | undefined
    ) ?? {}
    return {
      width: (params.fallback_width as number | undefined) ?? 1024,
      height: (params.fallback_height as number | undefined) ?? 1024,
      steps: (params.fallback_steps as number | undefined) ?? 4,
      guidance: (params.fallback_guidance as number | undefined) ?? 1,
      seed: params.seed == null ? '' : String(params.seed),
      negativePrompt: (params.fallback_negative_prompt as string | undefined) ?? '',
    }
  }, [settings])
  const currentDrawThingsParams = useMemo(
    () => buildDrawThingsParams(localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt),
    [localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt]
  )
  const effectiveRecommendation = useMemo(() => {
    if (!selectedRecommendation) return null
    return {
      width: selectedRecommendation.width ?? drawThingsFallbacks.width,
      height: selectedRecommendation.height ?? drawThingsFallbacks.height,
      steps: selectedRecommendation.steps ?? drawThingsFallbacks.steps,
      guidance: selectedRecommendation.guidance ?? drawThingsFallbacks.guidance,
      negativePrompt: selectedRecommendation.negativePrompt ?? drawThingsFallbacks.negativePrompt,
    }
  }, [selectedRecommendation, drawThingsFallbacks])
  const localSizeValue = useMemo(() => {
    const preset = DRAWTHINGS_SIZE_PRESETS.find((s) => s.width === localWidth && s.height === localHeight)
    return preset ? `${preset.width}x${preset.height}` : CUSTOM_DRAWTHINGS_SIZE
  }, [localWidth, localHeight])
  const openaiSizeValue = useMemo(() => {
    if (!openaiModelDef) return CUSTOM_OPENAI_SIZE
    return findPresetValue(openaiModelDef.sizes, openaiWidth, openaiHeight)
      ?? (openaiModelDef.supportsCustomSizes ? CUSTOM_OPENAI_SIZE : `${openaiModelDef.sizes[0]?.width ?? 1024}x${openaiModelDef.sizes[0]?.height ?? 1024}`)
  }, [openaiModelDef, openaiWidth, openaiHeight])
  const canRestoreRecommended = effectiveRecommendation !== null && (
    localWidth !== effectiveRecommendation.width ||
    localHeight !== effectiveRecommendation.height ||
    localSteps !== effectiveRecommendation.steps ||
    localGuidance !== effectiveRecommendation.guidance ||
    negativePrompt !== effectiveRecommendation.negativePrompt
  )

  const handleLocalSizeChange = (value: string): void => {
    if (value === CUSTOM_DRAWTHINGS_SIZE) return
    const preset = DRAWTHINGS_SIZE_PRESETS.find((s) => `${s.width}x${s.height}` === value)
    if (!preset) return
    setLocalWidth(preset.width)
    setLocalHeight(preset.height)
  }

  const handleOpenAiSizeChange = useCallback((value: string): void => {
    if (!openaiModelDef || value === CUSTOM_OPENAI_SIZE) return
    const preset = openaiModelDef.sizes.find((size) => `${size.width}x${size.height}` === value)
    if (!preset) return
    setOpenaiWidth(preset.width)
    setOpenaiHeight(preset.height)
  }, [openaiModelDef])

  const handleOpenAiWidthChange = useCallback((value: string): void => {
    setOpenaiWidth(normalizeOpenAiDimension(Number.parseInt(value, 10)))
  }, [])

  const handleOpenAiHeightChange = useCallback((value: string): void => {
    setOpenaiHeight(normalizeOpenAiDimension(Number.parseInt(value, 10)))
  }, [])

  const serializeProprietarySnapshot = useCallback((nextModel: string, params: Record<string, unknown>): string => {
    return JSON.stringify({ model: nextModel, params })
  }, [])

  const flushPendingDrawThingsParams = useCallback((
    modelFile = latestDrawThingsSaveRef.current.model,
    params = latestDrawThingsSaveRef.current.params
  ): void => {
    if (saveParamsTimerRef.current) {
      clearTimeout(saveParamsTimerRef.current)
      saveParamsTimerRef.current = null
    }
    if (backendId !== 'drawthings' || !modelFile) return
    void window.electronAPI.dtSaveModelParams(modelFile, params)
  }, [backendId])

  const refreshDrawThingsModels = useCallback((isInitial = false): void => {
    if (backendId !== 'drawthings') return
    window.electronAPI.localCheckCli().then((status) => {
      setCliStatus(status)
      if (!status.installed) {
        setDownloadedModels([])
        return
      }
      window.electronAPI.localListDownloadedModels().then((list) => {
        const sortedList = sortLocalModels(list)
        setDownloadedModels((prev) => {
          const prevFiles = prev.map((m) => m.file).join(',')
          const nextFiles = sortedList.map((m) => m.file).join(',')
          if (prevFiles === nextFiles) return prev
          if (isInitial || sortedList.length > 0) {
            setModel((cur) => (sortedList.find((m) => m.file === cur) ? cur : sortedList[0]?.file ?? ''))
          }
          return sortedList
        })
      })
    })
  }, [backendId])

  const handleRestoreRecommended = useCallback((): void => {
    if (!effectiveRecommendation) return
    setLocalWidth(effectiveRecommendation.width)
    setLocalHeight(effectiveRecommendation.height)
    setLocalSteps(effectiveRecommendation.steps)
    setLocalGuidance(effectiveRecommendation.guidance)
    setNegativePrompt(effectiveRecommendation.negativePrompt)
  }, [effectiveRecommendation])

  const handleDrawThingsModelChange = useCallback((nextModel: string): void => {
    flushPendingDrawThingsParams()
    setModel(nextModel)
  }, [flushPendingDrawThingsParams])

  useEffect(() => {
    if (backendId !== 'drawthings') return
    setLocalWidth(drawThingsFallbacks.width)
    setLocalHeight(drawThingsFallbacks.height)
    setLocalSteps(drawThingsFallbacks.steps)
    setLocalGuidance(drawThingsFallbacks.guidance)
    setLocalSeed(drawThingsFallbacks.seed)
    setNegativePrompt(drawThingsFallbacks.negativePrompt)
  }, [backendId, drawThingsFallbacks])

  useEffect(() => {
    if (backendId !== 'drawthings' || !model) return
    let cancelled = false

    Promise.all([
      window.electronAPI.dtGetModelParams(model),
      window.electronAPI.resolveRecommendation(model),
    ]).then(([saved, recommendation]) => {
      if (cancelled) return
      setSelectedRecommendation(recommendation)
      if (saved) {
        setLocalWidth(saved.width)
        setLocalHeight(saved.height)
        setLocalSteps(saved.steps)
        setLocalGuidance(saved.guidance)
        setLocalSeed(saved.seed)
        setNegativePrompt(saved.negativePrompt)
      } else {
        setLocalWidth(recommendation?.width ?? drawThingsFallbacks.width)
        setLocalHeight(recommendation?.height ?? drawThingsFallbacks.height)
        setLocalSteps(recommendation?.steps ?? drawThingsFallbacks.steps)
        setLocalGuidance(recommendation?.guidance ?? drawThingsFallbacks.guidance)
        setLocalSeed(drawThingsFallbacks.seed)
        setNegativePrompt(recommendation?.negativePrompt ?? drawThingsFallbacks.negativePrompt)
      }
    })

    return () => { cancelled = true }
  }, [backendId, model, drawThingsFallbacks, recommendationRevision])

  // Check CLI status and load models on mount (local backend only)
  useEffect(() => {
    if (backendId !== 'drawthings') return
    refreshDrawThingsModels(true)
    const id = window.setInterval(() => refreshDrawThingsModels(false), 30000)
    const handleFocus = (): void => refreshDrawThingsModels(false)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', handleFocus)
    }
  }, [backendId, refreshDrawThingsModels])

  useEffect(() => {
    if (backendId !== 'drawthings') return
    return window.electronAPI.onCliJobStatus((event) => {
      if (event.status === 'exited' || event.status === 'killed') {
        refreshDrawThingsModels(false)
      }
    })
  }, [backendId, refreshDrawThingsModels])

  useEffect(() => {
    if (backendId !== 'drawthings') return
    const handler = (): void => setShowModelsModal(true)
    const recommendationHandler = (): void => setRecommendationRevision((value) => value + 1)
    window.addEventListener('open-models-modal', handler)
    window.addEventListener('recommendations-updated', recommendationHandler)
    return () => {
      window.removeEventListener('open-models-modal', handler)
      window.removeEventListener('recommendations-updated', recommendationHandler)
    }
  }, [backendId])

  useEffect(() => {
    latestDrawThingsSaveRef.current = { model, params: currentDrawThingsParams }
  }, [model, currentDrawThingsParams])

  useEffect(() => {
    return () => {
      flushPendingDrawThingsParams()
    }
  }, [flushPendingDrawThingsParams])

  // Autosave Draw Things params ~800ms after any change so they persist across model switches.
  useEffect(() => {
    if (backendId !== 'drawthings' || !model) return
    if (saveParamsTimerRef.current) clearTimeout(saveParamsTimerRef.current)
    saveParamsTimerRef.current = setTimeout(() => {
      saveParamsTimerRef.current = null
      void window.electronAPI.dtSaveModelParams(model, currentDrawThingsParams)
    }, 800)
    return () => {
      if (saveParamsTimerRef.current) clearTimeout(saveParamsTimerRef.current)
    }
  }, [backendId, model, currentDrawThingsParams])

  useEffect(() => {
    if (!backendSettings || backendId === 'drawthings') return

    const savedDefaultParams = (backendSettings.default_params as Record<string, unknown> | undefined) ?? {}
    const savedModel = typeof backendSettings.model === 'string' && models.some((m) => m.id === backendSettings.model)
      ? backendSettings.model
      : (defaultModel?.id ?? '')

    setModel(savedModel)

    if (backendId === 'openai') {
      const nextModelDef = (models.find((m) => m.id === savedModel) ?? defaultModel) as OpenAIModelDef | undefined
      if (!nextModelDef) return
      const nextSize = resolveOpenAiSize(nextModelDef, savedDefaultParams.width, savedDefaultParams.height)
      const nextModeration = typeof savedDefaultParams.moderation === 'string' && nextModelDef.moderations.includes(savedDefaultParams.moderation as OpenAIModeration)
        ? savedDefaultParams.moderation as OpenAIModeration
        : (nextModelDef.moderations.find((moderation) => moderation === 'auto') ?? nextModelDef.moderations[0])
      const nextQuality = typeof savedDefaultParams.quality === 'string' && nextModelDef.qualities.includes(savedDefaultParams.quality as OpenAIQuality)
        ? savedDefaultParams.quality as OpenAIQuality
        : (nextModelDef.qualities.find((quality) => quality === 'auto') ?? nextModelDef.qualities[0])
      const nextOutputFormat = typeof savedDefaultParams.outputFormat === 'string' && nextModelDef.outputFormats.includes(savedDefaultParams.outputFormat as OpenAIOutputFormat)
        ? savedDefaultParams.outputFormat as OpenAIOutputFormat
        : (nextModelDef.outputFormats.find((format) => format === 'png') ?? nextModelDef.outputFormats[0])
      const nextBackground = typeof savedDefaultParams.background === 'string' && nextModelDef.backgrounds.includes(savedDefaultParams.background as OpenAIBackground)
        ? savedDefaultParams.background as OpenAIBackground
        : (nextModelDef.backgrounds.find((background) => background === 'opaque') ?? nextModelDef.backgrounds[0])
      setOpenaiWidth(nextSize.width)
      setOpenaiHeight(nextSize.height)
      setModeration(nextModeration)
      setQuality(nextQuality)
      setOutputFormat(nextOutputFormat)
      setBackground(nextBackground)
      persistedProprietarySnapshotRef.current = serializeProprietarySnapshot(savedModel, {
        width: nextSize.width,
        height: nextSize.height,
        moderation: nextModeration,
        quality: nextQuality,
        outputFormat: nextOutputFormat,
        background: nextBackground,
      })
      return
    }

    if (backendId === 'imagen') {
      const nextModelDef = (models.find((m) => m.id === savedModel) ?? defaultModel) as unknown as ImagenModelDef | undefined
      if (!nextModelDef) return
      const nextAspectRatio = typeof savedDefaultParams.aspectRatio === 'string' && IMAGEN_ASPECT_RATIOS.some((item) => item.value === savedDefaultParams.aspectRatio)
        ? savedDefaultParams.aspectRatio
        : '1:1'
      const nextImageSize = typeof savedDefaultParams.imageSize === 'string' && nextModelDef.imageSizes.some((item) => item.value === savedDefaultParams.imageSize)
        ? savedDefaultParams.imageSize
        : '1K'
      const nextPersonGeneration = typeof savedDefaultParams.personGeneration === 'string' && nextModelDef.personGeneration.includes(savedDefaultParams.personGeneration as ImagenPersonGeneration)
        ? savedDefaultParams.personGeneration as ImagenPersonGeneration
        : (nextModelDef.personGeneration.find((value) => value === 'allow_all') ?? nextModelDef.personGeneration[0])
      setAspectRatio(nextAspectRatio)
      setImageSize(nextImageSize)
      setPersonGeneration(nextPersonGeneration)
      persistedProprietarySnapshotRef.current = serializeProprietarySnapshot(savedModel, {
        aspectRatio: nextAspectRatio,
        imageSize: nextImageSize,
        personGeneration: nextPersonGeneration,
      })
      return
    }

    if (backendId === 'nanobanana') {
      const nextModelDef = (models.find((m) => m.id === savedModel) ?? defaultModel) as unknown as NanoBananaModelDef | undefined
      if (!nextModelDef) return
      const nextAspectRatio = typeof savedDefaultParams.aspectRatio === 'string' && nextModelDef.aspectRatios.some((item) => item.value === savedDefaultParams.aspectRatio)
        ? savedDefaultParams.aspectRatio
        : (nextModelDef.aspectRatios[0]?.value ?? '1:1')
      const nextImageSize = typeof savedDefaultParams.imageSize === 'string' && nextModelDef.imageSizes.some((item) => item.value === savedDefaultParams.imageSize)
        ? savedDefaultParams.imageSize
        : (nextModelDef.imageSizes[0]?.value ?? '1K')
      setNanoBananaAspectRatio(nextAspectRatio)
      setNanoBananaImageSize(nextImageSize)
      persistedProprietarySnapshotRef.current = serializeProprietarySnapshot(
        savedModel,
        nextModelDef.supportsImageConfig ? { aspectRatio: nextAspectRatio, imageSize: nextImageSize } : {}
      )
      return
    }

    if (backendId === 'grok') {
      const nextAspectRatio = typeof savedDefaultParams.aspectRatio === 'string' && GROK_ASPECT_RATIOS.some((item) => item.value === savedDefaultParams.aspectRatio)
        ? savedDefaultParams.aspectRatio as GrokAspectRatio
        : '1:1'
      const nextResolution = typeof savedDefaultParams.resolution === 'string' && GROK_RESOLUTIONS.some((item) => item.value === savedDefaultParams.resolution)
        ? savedDefaultParams.resolution as GrokResolution
        : '1k'
      setGrokAspectRatio(nextAspectRatio)
      setGrokResolution(nextResolution)
      persistedProprietarySnapshotRef.current = serializeProprietarySnapshot(savedModel, {
        aspectRatio: nextAspectRatio,
        resolution: nextResolution,
      })
      return
    }

    if (backendId === 'flux') {
      const nextModelDef = (models.find((m) => m.id === savedModel) ?? defaultModel) as unknown as FluxModelDef | undefined
      if (!nextModelDef) return
      const nextSizeIdx = FLUX_SIZES.findIndex(
        (size) => size.width === savedDefaultParams.width && size.height === savedDefaultParams.height
      )
      const size = FLUX_SIZES[nextSizeIdx >= 0 ? nextSizeIdx : 0]
      const nextSteps = nextModelDef.stepsRange && typeof savedDefaultParams.steps === 'number'
        ? Math.max(nextModelDef.stepsRange.min, Math.min(nextModelDef.stepsRange.max, savedDefaultParams.steps))
        : (nextModelDef.stepsRange?.default ?? 50)
      const nextGuidance = nextModelDef.guidanceRange && typeof savedDefaultParams.guidance === 'number'
        ? Math.max(nextModelDef.guidanceRange.min, Math.min(nextModelDef.guidanceRange.max, savedDefaultParams.guidance))
        : (nextModelDef.guidanceRange?.default ?? 5)
      const nextSeed = savedDefaultParams.seed == null ? '' : String(savedDefaultParams.seed)
      setFluxSizeIdx(nextSizeIdx >= 0 ? nextSizeIdx : 0)
      if (nextModelDef.stepsRange) setFluxSteps(nextSteps)
      if (nextModelDef.guidanceRange) setFluxGuidance(nextGuidance)
      setFluxSeed(nextSeed)
      const normalizedParams: Record<string, unknown> = { width: size.width, height: size.height }
      if (nextModelDef.stepsRange) normalizedParams.steps = nextSteps
      if (nextModelDef.guidanceRange) normalizedParams.guidance = nextGuidance
      if (nextSeed) normalizedParams.seed = Number.parseInt(nextSeed, 10)
      persistedProprietarySnapshotRef.current = serializeProprietarySnapshot(savedModel, normalizedParams)
    }
  }, [
    backendId,
    backendSettings,
    models,
    defaultModel,
    serializeProprietarySnapshot,
  ])

  // Update defaults when model changes
  useEffect(() => {
    if (backendId === 'openai' && openaiModelDef) {
      // Reset moderation/quality/background if the current value isn't valid for the new model
      setModeration((prev) => openaiModelDef.moderations.includes(prev) ? prev : 'auto')
      setQuality((prev) => openaiModelDef.qualities.includes(prev) ? prev : 'auto')
      setOutputFormat((prev) => openaiModelDef.outputFormats.includes(prev) ? prev : 'png')
      setBackground((prev) => openaiModelDef.backgrounds.includes(prev) ? prev : 'opaque')
      const nextSize = resolveOpenAiSize(openaiModelDef, openaiWidth, openaiHeight)
      if (nextSize.width !== openaiWidth) setOpenaiWidth(nextSize.width)
      if (nextSize.height !== openaiHeight) setOpenaiHeight(nextSize.height)
    } else if (backendId === 'imagen' && imagenModelDef) {
      setAspectRatio((prev) => IMAGEN_ASPECT_RATIOS.some((ar) => ar.value === prev) ? prev : '1:1')
      setImageSize((prev) => imagenModelDef.imageSizes.some((size) => size.value === prev) ? prev : '1K')
      setPersonGeneration((prev) =>
        imagenModelDef.personGeneration.includes(prev) ? prev : (imagenModelDef.personGeneration.find((value) => value === 'allow_all') ?? imagenModelDef.personGeneration[0])
      )
    } else if (backendId === 'nanobanana' && nanoBananaModelDef?.supportsImageConfig) {
      setNanoBananaAspectRatio((prev) =>
        nanoBananaModelDef.aspectRatios.some((ar) => ar.value === prev) ? prev : '1:1'
      )
      setNanoBananaImageSize((prev) =>
        nanoBananaModelDef.imageSizes.some((s) => s.value === prev) ? prev : '1K'
      )
    } else if (backendId === 'flux') {
      const m = findModel('flux', model) as FluxModelDef | undefined
      if (m) {
        if (m.stepsRange) {
          setFluxSteps((prev) =>
            prev >= m.stepsRange!.min && prev <= m.stepsRange!.max
              ? prev
              : m.stepsRange!.default
          )
        }
        if (m.guidanceRange) {
          setFluxGuidance((prev) =>
            prev >= m.guidanceRange!.min && prev <= m.guidanceRange!.max
              ? prev
              : m.guidanceRange!.default
          )
        }
      }
    }
  }, [backendId, model, openaiModelDef, openaiWidth, openaiHeight, imagenModelDef, nanoBananaModelDef])

  const currentEnqueueParams = useMemo<Record<string, unknown>>(() => {
    if (backendId === 'openai') {
      return {
        width: openaiWidth,
        height: openaiHeight,
        moderation,
        quality,
        outputFormat,
        background,
      }
    }
    if (backendId === 'imagen') {
      return { aspectRatio, imageSize, personGeneration }
    }
    if (backendId === 'flux') {
      const size = FLUX_SIZES[fluxSizeIdx]
      const params: Record<string, unknown> = { width: size.width, height: size.height }
      if (fluxModelDef?.stepsRange) params.steps = fluxSteps
      if (fluxModelDef?.guidanceRange) params.guidance = fluxGuidance
      const parsedSeed = fluxSeed ? Number.parseInt(fluxSeed, 10) : NaN
      if (!Number.isNaN(parsedSeed)) params.seed = parsedSeed
      return params
    }
    if (backendId === 'drawthings') {
      const params: Record<string, unknown> = {
        width: localWidth,
        height: localHeight,
        steps: localSteps,
        guidance: localGuidance
      }
      const parsedSeed = localSeed ? Number.parseInt(localSeed, 10) : NaN
      if (!Number.isNaN(parsedSeed)) params.seed = parsedSeed
      if (negativePrompt) params.negativePrompt = negativePrompt
      return params
    }
    if (backendId === 'grok') {
      return { aspectRatio: grokAspectRatio, resolution: grokResolution }
    }
    if (backendId === 'nanobanana' && nanoBananaModelDef?.supportsImageConfig) {
      return { aspectRatio: nanoBananaAspectRatio, imageSize: nanoBananaImageSize }
    }
    return {}
  }, [
    backendId,
    openaiWidth,
    openaiHeight,
    moderation,
    quality,
    outputFormat,
    background,
    aspectRatio,
    imageSize,
    personGeneration,
    fluxSizeIdx,
    fluxModelDef,
    fluxSteps,
    fluxGuidance,
    fluxSeed,
    localWidth,
    localHeight,
    localSteps,
    localGuidance,
    localSeed,
    negativePrompt,
    grokAspectRatio,
    grokResolution,
    nanoBananaModelDef,
    nanoBananaAspectRatio,
    nanoBananaImageSize
  ])

  useEffect(() => {
    if (!model) {
      setSnapshot(backendId, null)
      return
    }
    setSnapshot(backendId, { model, params: currentEnqueueParams })
  }, [backendId, model, currentEnqueueParams, setSnapshot])

  useEffect(() => {
    return () => { setSnapshot(backendId, null) }
  }, [backendId, setSnapshot])

  useEffect(() => {
    if (backendId === 'drawthings' || !settings || !model) return
    const nextSnapshot = serializeProprietarySnapshot(model, currentEnqueueParams)
    if (nextSnapshot === persistedProprietarySnapshotRef.current) return
    if (proprietarySaveTimerRef.current) clearTimeout(proprietarySaveTimerRef.current)
    proprietarySaveTimerRef.current = setTimeout(() => {
      proprietarySaveTimerRef.current = null
      const backends = (settings.image_backends as Record<string, Record<string, unknown>> | undefined) ?? {}
      const currentBackendSettings = backends[backendId] ?? {}
      const nextSettings = {
        ...settings,
        image_backends: {
          ...backends,
          [backendId]: {
            ...currentBackendSettings,
            model,
            default_params: {
              ...((currentBackendSettings.default_params as Record<string, unknown> | undefined) ?? {}),
              ...currentEnqueueParams,
            },
          },
        },
      }
      void updateSettings(nextSettings).then(() => {
        persistedProprietarySnapshotRef.current = nextSnapshot
      }).catch((error) => {
        void window.electronAPI.appLog('error', 'Failed to persist proprietary queue defaults', {
          backend: backendId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, 800)
    return () => {
      if (proprietarySaveTimerRef.current) clearTimeout(proprietarySaveTimerRef.current)
    }
  }, [backendId, settings, model, currentEnqueueParams, serializeProprietarySnapshot, updateSettings])

  useEffect(() => {
    return () => {
      if (proprietarySaveTimerRef.current) clearTimeout(proprietarySaveTimerRef.current)
    }
  }, [])

  const doEnqueue = useCallback((prompt: string, countOverride?: number) => {
    if (!prompt.trim()) return
    if (apiKeyMissing) return
    if (backendId === 'drawthings' && (!cliStatus?.installed || downloadedModels.length === 0)) return

    const count = Math.max(1, countOverride ?? 1)

    if (backendId === 'drawthings') {
      flushPendingDrawThingsParams(model, currentDrawThingsParams)
    }
    enqueue({ prompt, backend: backendId, model, params: currentEnqueueParams, count })
  }, [
    backendId,
    model,
    apiKeyMissing,
    cliStatus,
    downloadedModels,
    currentDrawThingsParams,
    flushPendingDrawThingsParams,
    enqueue,
    currentEnqueueParams
  ])

  // Listen for enqueue-all and enqueue-single events from PromptPane
  useEffect(() => {
    const handleAll = (e: Event): void => {
      const detail = (e as CustomEvent).detail
      doEnqueue(detail.prompt, detail.count)
    }
    const handleSingle = (e: Event): void => {
      const detail = (e as CustomEvent).detail
      if (detail.backend === backendId) doEnqueue(detail.prompt, detail.count)
    }
    window.addEventListener('enqueue-all', handleAll)
    window.addEventListener('enqueue-single', handleSingle)
    return () => {
      window.removeEventListener('enqueue-all', handleAll)
      window.removeEventListener('enqueue-single', handleSingle)
    }
  }, [backendId, doEnqueue])

  const renderSizeSelect = (sizes: SizePreset[], idx: number, setIdx: (n: number) => void): React.JSX.Element => (
    <div className="setting-row">
      <label>size</label>
      <select value={idx} onChange={(e) => setIdx(parseInt(e.target.value))}>
        {sizes.map((s, i) => (
          <option key={i} value={i}>{s.label}</option>
        ))}
      </select>
    </div>
  )

  return (
    <>
    <div className="queue-column" data-backend={backendId}>
      <div className="column-header">{label}</div>

      <div className="column-settings">
        {backendId !== 'drawthings' && (
          <div className="setting-row">
            <label>model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* OpenAI parameters */}
        {backendId === 'openai' && openaiModelDef && (
          <>
            <div className="setting-row">
              <label>size</label>
              <select value={openaiSizeValue} onChange={(e) => handleOpenAiSizeChange(e.target.value)}>
                {openaiModelDef.sizes.map((size) => (
                  <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>{size.label}</option>
                ))}
                {openaiModelDef.supportsCustomSizes && (
                  <option value={CUSTOM_OPENAI_SIZE}>Custom width/height</option>
                )}
              </select>
            </div>
            {openaiModelDef.supportsCustomSizes && (
              <>
                <div className="setting-row">
                  <label>width</label>
                  <input
                    type="number"
                    min={OPENAI_GPT2_MIN_EDGE}
                    max={OPENAI_GPT2_MAX_EDGE}
                    step={OPENAI_GPT2_SIZE_STEP}
                    value={openaiWidth}
                    onChange={(e) => handleOpenAiWidthChange(e.target.value)}
                  />
                </div>
                <div className="setting-row">
                  <label>height</label>
                  <input
                    type="number"
                    min={OPENAI_GPT2_MIN_EDGE}
                    max={OPENAI_GPT2_MAX_EDGE}
                    step={OPENAI_GPT2_SIZE_STEP}
                    value={openaiHeight}
                    onChange={(e) => handleOpenAiHeightChange(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="setting-row">
              <label>moderation</label>
              <select value={moderation} onChange={(e) => setModeration(e.target.value as OpenAIModeration)}>
                {openaiModelDef.moderations.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>quality</label>
              <select value={quality} onChange={(e) => setQuality(e.target.value as OpenAIQuality)}>
                {openaiModelDef.qualities.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>format</label>
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as OpenAIOutputFormat)}>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </div>
            <div className="setting-row">
              <label>background</label>
              <select value={background} onChange={(e) => setBackground(e.target.value as OpenAIBackground)}>
                {openaiModelDef.backgrounds.map((bg) => (
                  <option key={bg} value={bg}>{bg.charAt(0).toUpperCase() + bg.slice(1)}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Imagen parameters */}
        {backendId === 'imagen' && (
          <>
            <div className="setting-row">
              <label>aspect</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                {IMAGEN_ASPECT_RATIOS.map((ar) => (
                  <option key={ar.value} value={ar.value}>{ar.label}</option>
                ))}
              </select>
            </div>
            {imagenModelDef?.supportsImageSize && (
              <div className="setting-row">
                <label>size</label>
                <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                  {IMAGEN_IMAGE_SIZES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="setting-row">
              <label>persons</label>
              <select value={personGeneration} onChange={(e) => setPersonGeneration(e.target.value as ImagenPersonGeneration)}>
                <option value="dont_allow">Don't allow</option>
                <option value="allow_adult">Allow adult</option>
                <option value="allow_all">Allow all</option>
              </select>
            </div>
          </>
        )}

        {/* FLUX parameters */}
        {backendId === 'flux' && (
          <>
            {renderSizeSelect(FLUX_SIZES, fluxSizeIdx, setFluxSizeIdx)}
            {fluxModelDef?.stepsRange && (
              <div className="setting-row">
                <label>steps</label>
                <input
                  type="number"
                  value={fluxSteps}
                  onChange={(e) => {
                    const next = parseInt(e.target.value) || fluxModelDef.stepsRange!.default
                    setFluxSteps(Math.max(fluxModelDef.stepsRange!.min, Math.min(fluxModelDef.stepsRange!.max, next)))
                  }}
                  min={fluxModelDef.stepsRange.min}
                  max={fluxModelDef.stepsRange.max}
                />
              </div>
            )}
            {fluxModelDef?.guidanceRange && (
              <div className="setting-row">
                <label>guidance</label>
                <input
                  type="number"
                  value={fluxGuidance}
                  onChange={(e) => {
                    const next = parseFloat(e.target.value) || fluxModelDef.guidanceRange!.default
                    setFluxGuidance(Math.max(fluxModelDef.guidanceRange!.min, Math.min(fluxModelDef.guidanceRange!.max, next)))
                  }}
                  min={fluxModelDef.guidanceRange.min}
                  max={fluxModelDef.guidanceRange.max}
                  step={0.5}
                />
              </div>
            )}
            <div className="setting-row">
              <label>seed</label>
              <input type="text" value={fluxSeed} onChange={(e) => setFluxSeed(e.target.value)} placeholder="random" />
            </div>
          </>
        )}

        {/* Nano Banana parameters */}
        {backendId === 'nanobanana' && nanoBananaModelDef?.supportsImageConfig && (
          <>
            <div className="setting-row">
              <label>aspect</label>
              <select value={nanoBananaAspectRatio} onChange={(e) => setNanoBananaAspectRatio(e.target.value)}>
                {nanoBananaModelDef.aspectRatios.map((ar) => (
                  <option key={ar.value} value={ar.value}>{ar.label}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>size</label>
              <select value={nanoBananaImageSize} onChange={(e) => setNanoBananaImageSize(e.target.value)}>
                {nanoBananaModelDef.imageSizes.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Grok Imagine parameters */}
        {backendId === 'grok' && (
          <>
            <div className="setting-row">
              <label>aspect</label>
              <select value={grokAspectRatio} onChange={(e) => setGrokAspectRatio(e.target.value as GrokAspectRatio)}>
                {GROK_ASPECT_RATIOS.map((ar) => (
                  <option key={ar.value} value={ar.value}>{ar.label}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>size</label>
              <select value={grokResolution} onChange={(e) => setGrokResolution(e.target.value as GrokResolution)}>
                {GROK_RESOLUTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Draw Things parameters */}
        {backendId === 'drawthings' && (
          <>
            {cliStatus === null && (
              <div className="setting-row model-warning">Checking CLI…</div>
            )}
            {cliStatus && !cliStatus.installed && cliStatus.platform === 'darwin' && (
              <div className="setting-row model-warning">
                Draw Things CLI not installed.
                <code className="install-hint">brew install drawthingsai/draw-things/draw-things-cli</code>
              </div>
            )}
            {cliStatus && cliStatus.installed && (
              <>
                {downloadedModels.length > 0 ? (
                  <div className="setting-row">
                    <label>model</label>
                    <select value={model} onChange={(e) => handleDrawThingsModelChange(e.target.value)}>
                      {downloadedModels.map((m) => (
                        <option key={m.file} value={m.file}>{localModelName(m)}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="setting-row model-warning">
                    No models downloaded yet
                  </div>
                )}
                <div className="setting-row">
                  <label>size</label>
                  <select value={localSizeValue} onChange={(e) => handleLocalSizeChange(e.target.value)}>
                    {DRAWTHINGS_SIZE_PRESETS.map((s) => (
                      <option key={`${s.width}x${s.height}`} value={`${s.width}x${s.height}`}>{s.label}</option>
                    ))}
                    <option value={CUSTOM_DRAWTHINGS_SIZE}>Custom width/height</option>
                  </select>
                </div>
                <div className="setting-row">
                  <label>width</label>
                  <input type="number" value={localWidth} onChange={(e) => setLocalWidth(Math.max(64, parseInt(e.target.value) || 64))} min={64} step={64} />
                </div>
                <div className="setting-row">
                  <label>height</label>
                  <input type="number" value={localHeight} onChange={(e) => setLocalHeight(Math.max(64, parseInt(e.target.value) || 64))} min={64} step={64} />
                </div>
                <div className="setting-row">
                  <label>steps</label>
                  <input type="number" value={localSteps} onChange={(e) => setLocalSteps(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={50} />
                </div>
                <div className="setting-row">
                  <label>guidance</label>
                  <input type="number" value={localGuidance} onChange={(e) => setLocalGuidance(Math.max(1, parseFloat(e.target.value) || 1))} min={1} max={20} step={0.5} />
                </div>
                <div className="setting-row">
                  <label>seed</label>
                  <input type="text" value={localSeed} onChange={(e) => setLocalSeed(e.target.value)} placeholder="random" />
                </div>
                <div className="setting-row">
                  <label>neg.</label>
                  <input type="text" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder="negative prompt" />
                </div>
                {canRestoreRecommended && effectiveRecommendation && (
                  <div className="drawthings-recommendation-row">
                    <button
                      type="button"
                      className="open-models-btn drawthings-recommendation-btn"
                      title={`Restore Draw Things recommended parameters for ${selectedRecommendation?.matchName ?? model}`}
                      onClick={handleRestoreRecommended}
                    >
                      Restore recommended
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {apiKeyMissing && (
          <div className="setting-row model-warning">API key not set</div>
        )}

        <button
          className="enqueue-btn"
          disabled={!hasPrompt || apiKeyMissing || (backendId === 'drawthings' && (!cliStatus?.installed || downloadedModels.length === 0))}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('request-enqueue', { detail: { backend: backendId } })
            )
          }}
        >
          + Queue
        </button>
      </div>

      <div className="task-list" onClick={(e) => { if (e.target === e.currentTarget) clear() }}>
        {columnTasks.length === 0 ? (
          <div className="task-list-empty">No tasks queued</div>
        ) : (
          columnTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              backendId={backendId}
              isSelected={selection?.backend === backendId && selection.taskId === task.id}
              onClick={() => select(backendId, task.id)}
            />
          ))
        )}
      </div>
    </div>

    {showModelsModal && (
      <DrawThingsModelsModal
        onClose={() => setShowModelsModal(false)}
      />
    )}
    </>
  )
}

function TaskItem({ task, backendId, isSelected, onClick }: { task: Task; backendId: BackendId; isSelected: boolean; onClick: () => void }): React.JSX.Element {
  const { removeTask, restoreTask, deleteTask } = useSelection()
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if ((task.status !== 'completed' && task.status !== 'kept') || !task.baseName) return
    window.electronAPI.getImage(task.baseName).then((result) => {
      if (result) {
        const mime = result.ext === 'jpg' ? 'image/jpeg' : `image/${result.ext}`
        setThumbUrl(`data:${mime};base64,${result.data}`)
      }
    })
  }, [task.status, task.baseName])

  // Scroll into view when generation completes
  useEffect(() => {
    if (task.status === 'completed' && !task.baseName) {
      // No thumbnail — element size is already final, scroll now
      itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [task.status, task.baseName])

  const handleRemove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void removeTask(backendId, task.id)
  }
  const handleRestore = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void restoreTask(backendId, task.id)
  }
  const handleDelete = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void deleteTask(backendId, task.id)
  }
  const handleRetry = (e: React.MouseEvent): void => {
    e.stopPropagation()
    window.electronAPI.retryTask(backendId, task.id)
  }
  const getExt = (): string => task.imagePath?.split('.').pop() ?? 'png'
  const handleExport = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!task.baseName) return
    void window.electronAPI.exportImage(task.baseName, getExt())
  }
  const removeLabel = task.status === 'completed' ? 'keep' : 'rm'
  const removeTitle = task.status === 'completed' ? 'Mark as kept and remove from active list' : 'Remove from queue'
  const statusLabel = task.status === 'kept' ? 'kept' : task.status

  return (
    <div
      className={[
        'task-item',
        task.status === 'kept' ? 'task-item-kept' : '',
        isSelected ? 'task-item-selected' : ''
      ].filter(Boolean).join(' ')}
      ref={itemRef}
      onClick={onClick}
      data-task-id={task.id}
    >
      {thumbUrl && (
        <div className="task-thumbnail-frame">
          <img
            className="task-thumbnail"
            src={thumbUrl}
            alt=""
            onLoad={() => itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
          />
        </div>
      )}
      <div className="task-info">
        <div className="task-prompt" title={task.prompt}>
          {task.prompt}
        </div>
        <div className="task-status" style={{ color: STATUS_COLORS[task.status] }}>
          <span
            className={task.status === 'failed' ? 'task-error' : undefined}
            title={task.status === 'failed' && task.error ? task.error : undefined}
          >
            {task.status === 'failed'
              ? `failed: ${task.error || 'unknown error'}`
              : task.status === 'interrupted'
                ? 'interrupted'
                : statusLabel}
          </span>
          {task.estimatedCostUsd !== null && (
            <span className="task-cost">${task.estimatedCostUsd.toFixed(2)}</span>
          )}
        </div>
      </div>
      <div className="task-actions">
        {(task.status === 'failed' || task.status === 'interrupted') && (
          <button className="task-btn task-btn-retry" onClick={handleRetry} title="Retry">retry</button>
        )}
        {(task.status === 'completed' || task.status === 'kept') && task.baseName && (
          <button className="task-btn task-btn-exp" onClick={handleExport} title="Export to export folder">exp</button>
        )}
        {task.status === 'kept' && (
          <button className="task-btn task-btn-restore" onClick={handleRestore} title="Restore to active list">restore</button>
        )}
        {task.status !== 'generating' && task.status !== 'kept' && (
          <button className="task-btn task-btn-warn" onClick={handleRemove} title={removeTitle}>{removeLabel}</button>
        )}
        {(task.status === 'completed' || task.status === 'kept') && (
          <button className="task-btn task-btn-danger" onClick={handleDelete} title="Delete with files">del</button>
        )}
      </div>
    </div>
  )
}
