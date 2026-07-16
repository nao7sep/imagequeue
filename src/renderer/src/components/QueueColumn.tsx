import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSelection } from '../context/SelectionContext'
import { useSettings } from '../context/SettingsContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import type { BackendId, CloudBackendId, Task, CliStatus, LocalModelInfo, RecommendedParams, DrawThingsModelParams } from '../../../shared/types'
import { serializeError } from '../../../shared/serialize-error'
import { DependencyPanePointer } from './DependencyPanePointer'
import {
  getModelsForBackend,
  findModel,
  STANDARD_SIZE_PRESETS,
  OPENAI_GPT2_MAX_EDGE,
  OPENAI_GPT2_MIN_EDGE,
  OPENAI_GPT2_SIZE_STEP,
  OPENAI_OUTPUT_FORMAT_LABELS,
  IMAGEN_PERSON_GENERATION_LABELS,
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
import { singleLine, truncate, PROMPT_PREVIEW_MIN_GRAPHEMES } from '../utils/textCleanup'
import { useAutosavedImageBackendDefaults } from '../hooks/useAutosavedImageBackendDefaults'
import {
  normalizeOpenAiDimension,
  resolveOpenAiSize,
  resolveSavedImageBackendDefaults,
  type SavedImageBackendDefaults,
} from '../utils/imageBackendDefaults'
import { localModelName, sortLocalModels } from '../utils/localModels'
import { isBackendReadyToEnqueue } from '../utils/enqueue'
import { isFreshCompletion } from '../utils/taskScroll'
import { useImeGuard } from '../utils/imeGuard'
import './QueueColumn.css'

interface Props {
  backendId: BackendId
  label: string
  prompt: string
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
const DRAWTHINGS_SIZE_PRESETS: SizePreset[] = STANDARD_SIZE_PRESETS

// Sends a save error to the session log. Used by the fire-and-forget autosave
// paths so a halted main-side write (e.g., when params.json is unreadable) is
// recorded instead of becoming an unhandled promise rejection. The user-
// visible symptom remains "saves don't persist", which they'll notice on
// reload — the log entry exists for diagnosis.
function logSaveError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  void window.electronAPI.appLog('error', 'Renderer save failed', { context, error: serializeError(err), ...extra })
}

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

export function QueueColumn({ backendId, label, prompt }: Props): React.JSX.Element {
  const hasPrompt = prompt.trim().length > 0
  const { tasks } = useQueue()
  const {
    selection,
    select,
    clear,
    navigate,
    selectEdge,
    removeSelected,
    restoreSelected,
    deleteSelected,
  } = useSelection()
  const isComposing = useImeGuard()
  const { settings, saveImageBackendDefaults } = useSettings()
  const { setSnapshot, enqueueToBackend } = useEnqueueConfigs()
  const models = getModelsForBackend(backendId)
  const defaultModel = models.find((m) => m.isDefault) ?? models[0]
  const [model, setModel] = useState(defaultModel?.id ?? '')
  const proprietaryBackend = backendId === 'drawthings' ? null : backendId as CloudBackendId

  // Per-backend model definitions, used to drive that backend's dynamic option
  // controls. Each resolves only for its own backend (null otherwise) via the
  // typed findModel lookup, falling back to the backend's first model. No
  // cross-type casting needed.
  const openaiModelDef = useMemo(
    () => (backendId === 'openai' ? findModel('openai', model) ?? getModelsForBackend('openai')[0] : null),
    [backendId, model]
  )

  const imagenModelDef = useMemo(
    () => (backendId === 'imagen' ? findModel('imagen', model) ?? getModelsForBackend('imagen')[0] : null),
    [backendId, model]
  )

  const nanoBananaModelDef = useMemo(
    () => (backendId === 'nanobanana' ? findModel('nanobanana', model) ?? getModelsForBackend('nanobanana')[0] : null),
    [backendId, model]
  )

  const fluxModelDef = useMemo(
    () => (backendId === 'flux' ? findModel('flux', model) ?? getModelsForBackend('flux')[0] : null),
    [backendId, model]
  )

  const grokModelDef = useMemo(
    () => (backendId === 'grok' ? findModel('grok', model) ?? getModelsForBackend('grok')[0] : null),
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
  const [allModelParams, setAllModelParams] = useState<Record<string, DrawThingsModelParams>>({})
  // Tracks which model's saved params are currently reflected in local state.
  // The autosave effect uses this to skip writes between a model switch and
  // the new model's load completing, so we never persist model A's params
  // under model B's key.
  const [loadedModel, setLoadedModel] = useState('')

  const columnTasks = tasks[backendId]
  const settingsLoaded = settings !== null
  const backendSettings = useMemo(
    () => (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.[backendId] ?? null,
    [settings, backendId]
  )
  const savedProprietaryDefaults = useMemo(
    () => proprietaryBackend
      ? resolveSavedImageBackendDefaults(proprietaryBackend, backendSettings, models, defaultModel)
      : null,
    [proprietaryBackend, backendSettings, models, defaultModel]
  )
  const drawThingsDefaultParams = (
    (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
      ?.default_params as Record<string, unknown> | undefined
  ) ?? {}
  const drawThingsFallbackWidth = (drawThingsDefaultParams.fallback_width as number | undefined) ?? 1024
  const drawThingsFallbackHeight = (drawThingsDefaultParams.fallback_height as number | undefined) ?? 1024
  const drawThingsFallbackSteps = (drawThingsDefaultParams.fallback_steps as number | undefined) ?? 4
  const drawThingsFallbackGuidance = (drawThingsDefaultParams.fallback_guidance as number | undefined) ?? 1
  const drawThingsFallbackSeed = drawThingsDefaultParams.seed == null ? '' : String(drawThingsDefaultParams.seed)
  const drawThingsFallbackNegativePrompt = (drawThingsDefaultParams.fallback_negative_prompt as string | undefined) ?? ''
  const drawThingsFallbacks = useMemo(() => ({
    width: drawThingsFallbackWidth,
    height: drawThingsFallbackHeight,
    steps: drawThingsFallbackSteps,
    guidance: drawThingsFallbackGuidance,
    seed: drawThingsFallbackSeed,
    negativePrompt: drawThingsFallbackNegativePrompt,
  }), [
    drawThingsFallbackWidth,
    drawThingsFallbackHeight,
    drawThingsFallbackSteps,
    drawThingsFallbackGuidance,
    drawThingsFallbackSeed,
    drawThingsFallbackNegativePrompt,
  ])
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

  const refreshAllModelParams = useCallback(async (): Promise<void> => {
    if (backendId !== 'drawthings') return
    const store = await window.electronAPI.dtGetAllModelParams()
    setAllModelParams(store)
  }, [backendId])

  const canApplyToAllModels = useMemo(() => {
    if (backendId !== 'drawthings' || downloadedModels.length <= 1) return false
    return downloadedModels.some((m) => {
      if (m.file === model) return false
      const entry = allModelParams[m.file]
      if (!entry) return true
      return entry.width !== localWidth
        || entry.height !== localHeight
        || entry.steps !== localSteps
        || entry.guidance !== localGuidance
    })
  }, [backendId, downloadedModels, model, allModelParams, localWidth, localHeight, localSteps, localGuidance])

  const handleApplyToAllModels = useCallback(async (): Promise<void> => {
    if (backendId !== 'drawthings' || downloadedModels.length === 0) return
    const modelFiles = downloadedModels.map((m) => m.file)
    try {
      await window.electronAPI.dtApplyParamsToAllModels(modelFiles, {
        width: localWidth,
        height: localHeight,
        steps: localSteps,
        guidance: localGuidance,
      })
    } catch (err) {
      logSaveError('apply parameters to all Draw Things models', err, { modelCount: modelFiles.length })
      return
    }
    await refreshAllModelParams()
  }, [
    backendId,
    downloadedModels,
    localWidth,
    localHeight,
    localSteps,
    localGuidance,
    refreshAllModelParams,
  ])

  const handleDrawThingsModelChange = useCallback((nextModel: string): void => {
    setModel(nextModel)
    void refreshAllModelParams()
  }, [refreshAllModelParams])

  useEffect(() => {
    if (backendId !== 'drawthings') return
    void refreshAllModelParams()
  }, [backendId, downloadedModels, refreshAllModelParams])

  useEffect(() => {
    if (backendId !== 'drawthings') return
    setLocalWidth(drawThingsFallbacks.width)
    setLocalHeight(drawThingsFallbacks.height)
    setLocalSteps(drawThingsFallbacks.steps)
    setLocalGuidance(drawThingsFallbacks.guidance)
    setLocalSeed(drawThingsFallbacks.seed)
    setNegativePrompt(drawThingsFallbacks.negativePrompt)
    // Block autosave while these transient fallback values sit in local state;
    // the load effect re-opens the gate after the model's saved params land.
    setLoadedModel('')
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
      setLoadedModel(model)
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

  // A managed-dependency change (CLI installed/updated, or configs.json
  // downloaded/updated from the Dependencies modal) re-resolves this column: the
  // model list and CLI availability may have changed, and a new configs.json
  // changes the per-model recommended parameters.
  useEffect(() => {
    if (backendId !== 'drawthings') return
    const openModels = (): void => setShowModelsModal(true)
    const dependenciesChanged = (): void => {
      setRecommendationRevision((value) => value + 1)
      refreshDrawThingsModels(false)
    }
    window.addEventListener('open-models-modal', openModels)
    window.addEventListener('dependencies-changed', dependenciesChanged)
    return () => {
      window.removeEventListener('open-models-modal', openModels)
      window.removeEventListener('dependencies-changed', dependenciesChanged)
    }
  }, [backendId, refreshDrawThingsModels])

  // Autosave Draw Things params on every change. The main process coalesces
  // rapid writes and drains pending writes on `before-quit`, so we don't
  // debounce here. The `loadedModel === model` gate prevents writing model A's
  // params under model B's key during the brief window between a model switch
  // and the new model's load completing.
  useEffect(() => {
    if (backendId !== 'drawthings' || !model) return
    if (loadedModel !== model) return
    window.electronAPI.dtSaveModelParams(model, currentDrawThingsParams)
      .catch((err) => logSaveError('autosave Draw Things model parameters', err, { model }))
  }, [backendId, model, loadedModel, currentDrawThingsParams])

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
      setAspectRatio((prev) =>
        imagenModelDef.aspectRatios.some((ar) => ar.value === prev) ? prev : (imagenModelDef.aspectRatios[0]?.value ?? '1:1')
      )
      setImageSize((prev) =>
        imagenModelDef.imageSizes.some((size) => size.value === prev) ? prev : (imagenModelDef.imageSizes[0]?.value ?? '1K')
      )
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
      const m = findModel('flux', model)
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
    if (backendId === 'flux' && fluxModelDef) {
      // The ladder is the model's own, so an index carried over from a model with a
      // longer list can fall off the end; the first size is the safe floor.
      const size = fluxModelDef.sizes[fluxSizeIdx] ?? fluxModelDef.sizes[0]
      const params: Record<string, unknown> = { width: size.width, height: size.height }
      if (fluxModelDef.stepsRange) params.steps = fluxSteps
      if (fluxModelDef.guidanceRange) params.guidance = fluxGuidance
      const parsedSeed = fluxSeed ? Number.parseInt(fluxSeed, 10) : NaN
      params.seed = Number.isNaN(parsedSeed) ? null : parsedSeed
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
      // The negative prompt is a scalar field; clean it (flatten any pasted line
      // break, keep horizontal spacing) at this snapshot/commit point, then guard
      // emptiness on the cleaned value so an all-whitespace entry is dropped.
      const cleanedNegativePrompt = singleLine(negativePrompt)
      if (cleanedNegativePrompt) params.negativePrompt = cleanedNegativePrompt
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

  const applySavedProprietaryDefaults = useCallback((saved: SavedImageBackendDefaults): void => {
    setModel(saved.model)
    const ui = saved.ui
    if (backendId === 'openai') {
      setOpenaiWidth(ui.width as number)
      setOpenaiHeight(ui.height as number)
      setModeration(ui.moderation as OpenAIModeration)
      setQuality(ui.quality as OpenAIQuality)
      setOutputFormat(ui.outputFormat as OpenAIOutputFormat)
      setBackground(ui.background as OpenAIBackground)
      return
    }
    if (backendId === 'imagen') {
      setAspectRatio(ui.aspectRatio as string)
      setImageSize(ui.imageSize as string)
      setPersonGeneration(ui.personGeneration as ImagenPersonGeneration)
      return
    }
    if (backendId === 'nanobanana') {
      setNanoBananaAspectRatio(ui.aspectRatio as string)
      setNanoBananaImageSize(ui.imageSize as string)
      return
    }
    if (backendId === 'grok') {
      setGrokAspectRatio(ui.aspectRatio as GrokAspectRatio)
      setGrokResolution(ui.resolution as GrokResolution)
      return
    }
    if (backendId === 'flux') {
      setFluxSizeIdx(ui.sizeIdx as number)
      if (typeof ui.steps === 'number') setFluxSteps(ui.steps)
      if (typeof ui.guidance === 'number') setFluxGuidance(ui.guidance)
      setFluxSeed(ui.seed as string)
    }
  }, [backendId])

  useAutosavedImageBackendDefaults({
    backend: proprietaryBackend,
    settingsLoaded,
    saved: savedProprietaryDefaults,
    currentModel: model,
    currentParams: currentEnqueueParams,
    applySaved: applySavedProprietaryDefaults,
    saveDefaults: saveImageBackendDefaults,
  })

  // Backend-config readiness only (no prompt check — the prompt is validated by
  // the enqueue action). Mirrored into the snapshot so Send-to-All / Cmd+N can
  // skip not-ready backends, and reused for the "+ Queue" button's disabled state.
  const readyToEnqueue = isBackendReadyToEnqueue({
    backendId,
    apiKeyMissing,
    cliInstalled: !!cliStatus?.installed,
    downloadedModelCount: downloadedModels.length,
  })

  useEffect(() => {
    if (!model) {
      setSnapshot(backendId, null)
      return
    }
    setSnapshot(backendId, { model, params: currentEnqueueParams, ready: readyToEnqueue })
  }, [backendId, model, currentEnqueueParams, readyToEnqueue, setSnapshot])

  useEffect(() => {
    return () => { setSnapshot(backendId, null) }
  }, [backendId, setSnapshot])

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

  // This column is the board's listbox: its `.task-list` is one tab stop, and
  // while it has focus it owns all four arrows plus Home/End for navigation and
  // the scoped command keys for the selected task. Navigation (Up/Down within,
  // Left/Right to the adjacent column) is delegated to SelectionContext, which
  // keeps the single source of truth and follows focus to the moved-to row.
  // Backspace/Delete/Space form the command layer, scoped here so they act only
  // while focus is inside the queue — they read the selection from the context,
  // never from the DOM.
  const handleListKeyDown = useCallback((e: React.KeyboardEvent): void => {
    const sel = selection
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!sel) return
      e.preventDefault()
      navigate(
        e.key === 'ArrowUp' ? 'up' :
        e.key === 'ArrowDown' ? 'down' :
        e.key === 'ArrowLeft' ? 'left' : 'right'
      )
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      selectEdge(backendId, 'first')
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      selectEdge(backendId, 'last')
      return
    }
    if (!sel) return

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Backspace') {
      if (e.repeat) return
      e.preventDefault()
      void deleteSelected()
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Backspace') {
      if (e.repeat) return
      e.preventDefault()
      const task = tasks[sel.backend]?.find((t) => t.id === sel.taskId)
      if (task?.status === 'kept') void restoreSelected()
      else void removeSelected()
      return
    }
    if (e.key === 'Delete') {
      if (e.repeat) return
      e.preventDefault()
      void deleteSelected()
      return
    }
    if (e.key === ' ') {
      if (isComposing(e.nativeEvent)) return
      const task = tasks[sel.backend]?.find((t) => t.id === sel.taskId)
      if (task?.status !== 'completed' && task?.status !== 'kept') return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('viewer:toggle'))
    }
  }, [selection, navigate, selectEdge, backendId, tasks, deleteSelected, restoreSelected, removeSelected, isComposing])

  // The single roving tab stop for this column: the selected row when the
  // selection lives here, otherwise the first row. Exactly one option per column
  // is tabbable, so Tab enters the column at the active row and Tab leaves it.
  const tabbableTaskId = selection?.backend === backendId && columnTasks.some((t) => t.id === selection.taskId)
    ? selection.taskId
    : columnTasks[0]?.id ?? null

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
                {openaiModelDef.outputFormats.map((fmt) => (
                  <option key={fmt} value={fmt}>{OPENAI_OUTPUT_FORMAT_LABELS[fmt]}</option>
                ))}
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
        {backendId === 'imagen' && imagenModelDef && (
          <>
            <div className="setting-row">
              <label>aspect</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                {imagenModelDef.aspectRatios.map((ar) => (
                  <option key={ar.value} value={ar.value}>{ar.label}</option>
                ))}
              </select>
            </div>
            {imagenModelDef.supportsImageSize && (
              <div className="setting-row">
                <label>size</label>
                <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                  {imagenModelDef.imageSizes.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="setting-row">
              <label>persons</label>
              <select value={personGeneration} onChange={(e) => setPersonGeneration(e.target.value as ImagenPersonGeneration)}>
                {imagenModelDef.personGeneration.map((value) => (
                  <option key={value} value={value}>{IMAGEN_PERSON_GENERATION_LABELS[value]}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* FLUX parameters */}
        {backendId === 'flux' && fluxModelDef && (
          <>
            {renderSizeSelect(fluxModelDef.sizes, fluxSizeIdx, setFluxSizeIdx)}
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
        {backendId === 'grok' && grokModelDef && (
          <>
            <div className="setting-row">
              <label>aspect</label>
              <select value={grokAspectRatio} onChange={(e) => setGrokAspectRatio(e.target.value as GrokAspectRatio)}>
                {grokModelDef.aspectRatios.map((ar) => (
                  <option key={ar.value} value={ar.value}>{ar.label}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>size</label>
              <select value={grokResolution} onChange={(e) => setGrokResolution(e.target.value as GrokResolution)}>
                {grokModelDef.resolutions.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Draw Things parameters */}
        {backendId === 'drawthings' && (
          <>
            {/* The single pointer to the Dependencies modal — the only attention
                surface for the CLI and configs.json. It decides its own
                visibility (silent when both are fine). */}
            <DependencyPanePointer />
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
                {canApplyToAllModels && (
                  <button
                    type="button"
                    className="open-models-btn drawthings-recommendation-btn"
                    title="Copy width, height, steps, and guidance to every downloaded Draw Things model. Each model's seed and negative prompt are preserved."
                    onClick={() => { void handleApplyToAllModels() }}
                  >
                    Apply to all models
                  </button>
                )}
                <div className="setting-row">
                  <label>seed</label>
                  <input type="text" value={localSeed} onChange={(e) => setLocalSeed(e.target.value)} placeholder="random" />
                </div>
                <div className="setting-row">
                  <label>neg.</label>
                  <input type="text" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder="negative prompt" />
                </div>
                {canRestoreRecommended && effectiveRecommendation && (
                  <button
                    type="button"
                    className="open-models-btn drawthings-recommendation-btn"
                    title={`Restore Draw Things recommended parameters for ${selectedRecommendation?.matchName ?? model}`}
                    onClick={handleRestoreRecommended}
                  >
                    Use recommended
                  </button>
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
          disabled={!hasPrompt || !readyToEnqueue}
          onClick={() => enqueueToBackend(backendId, prompt)}
        >
          + Queue
        </button>
      </div>

      <div
        className="task-list"
        role="listbox"
        aria-label={`${label} queue`}
        onKeyDown={handleListKeyDown}
        onClick={(e) => { if (e.target === e.currentTarget) clear() }}
      >
        {columnTasks.length === 0 ? (
          <div className="task-list-empty">No tasks queued</div>
        ) : (
          columnTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              backendId={backendId}
              isSelected={selection?.backend === backendId && selection.taskId === task.id}
              isTabbable={task.id === tabbableTaskId}
              onSelect={() => select(backendId, task.id)}
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

function TaskItem({ task, backendId, isSelected, isTabbable, onSelect }: { task: Task; backendId: BackendId; isSelected: boolean; isTabbable: boolean; onSelect: () => void }): React.JSX.Element {
  const { removeTask, restoreTask, deleteTask } = useSelection()
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  // Seeded with the status at mount so an item that is *already* completed or
  // kept when it first renders — app launch restoring stored tasks, or the user
  // revealing kept images with ⌘⇧K — is not mistaken for a fresh completion.
  const prevStatusRef = useRef(task.status)
  // Armed on a genuine completion transition; consumed by the thumbnail's
  // onLoad so the scroll runs against the item's final height.
  const justCompletedRef = useRef(false)

  useEffect(() => {
    if ((task.status !== 'completed' && task.status !== 'kept') || !task.baseName) return
    window.electronAPI.getImage(task.baseName).then((result) => {
      if (result) {
        const mime = result.ext === 'jpg' ? 'image/jpeg' : `image/${result.ext}`
        setThumbUrl(`data:${mime};base64,${result.data}`)
      }
    })
  }, [task.status, task.baseName])

  // Auto-scroll only on a real queued/generating -> completed transition, so a
  // freshly generated image reveals itself. Mounting an already-completed task
  // or flipping kept items into the list must not move the viewport. A fresh
  // completion always carries a baseName (set together in the processor), so we
  // defer to the thumbnail's onLoad; the no-thumbnail branch is a safety net.
  useEffect(() => {
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = task.status
    if (!isFreshCompletion(prevStatus, task.status)) return
    if (task.baseName) {
      justCompletedRef.current = true
    } else {
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

  // One-line prompt preview: flatten the (possibly multiline) prompt to a single
  // line and cap the carried text at a generous grapheme budget. CSS still does
  // the visual ellipsis; the full prompt stays in the title tooltip.
  const promptPreview = truncate(task.prompt, PROMPT_PREVIEW_MIN_GRAPHEMES).text

  return (
    <div
      className={[
        'task-item',
        task.status === 'kept' ? 'task-item-kept' : '',
        isSelected ? 'task-item-selected' : ''
      ].filter(Boolean).join(' ')}
      ref={itemRef}
      role="option"
      aria-selected={isSelected}
      tabIndex={isTabbable ? 0 : -1}
      onClick={onSelect}
      // Activation follows focus: Tab-ing into the column (or focusing a row any
      // other way) commits that row as the selection, the single source of truth
      // the arrows and command keys then read. `select` only sets state — it
      // never moves focus — so this can't recurse with the nav focus-follow.
      onFocus={onSelect}
      data-task-id={task.id}
    >
      {thumbUrl && (
        <div className="task-thumbnail-frame">
          <img
            className="task-thumbnail"
            src={thumbUrl}
            alt=""
            onLoad={() => {
              if (!justCompletedRef.current) return
              justCompletedRef.current = false
              itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }}
          />
        </div>
      )}
      <div className="task-info">
        <div className="task-prompt" title={task.prompt}>
          {promptPreview}
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
        </div>
      </div>
      {/* Per-row actions are pointer-only affordances (tabIndex -1), never tab
          stops inside the listbox: the keyboard reaches them via the column's
          command keys (Backspace removes/keeps/restores, Delete deletes) on the
          active row. This keeps the column a single tab stop. */}
      <div className="task-actions">
        {(task.status === 'failed' || task.status === 'interrupted') && (
          <button tabIndex={-1} className="task-btn task-btn-retry" onClick={handleRetry} title="Retry">retry</button>
        )}
        {(task.status === 'completed' || task.status === 'kept') && task.baseName && (
          <button tabIndex={-1} className="task-btn task-btn-exp" onClick={handleExport} title="Export to export folder">exp</button>
        )}
        {task.status === 'kept' && (
          <button tabIndex={-1} className="task-btn task-btn-restore" onClick={handleRestore} title="Restore to active list">restore</button>
        )}
        {task.status !== 'generating' && task.status !== 'kept' && (
          <button tabIndex={-1} className="task-btn task-btn-warn" onClick={handleRemove} title={removeTitle}>{removeLabel}</button>
        )}
        {(task.status === 'completed' || task.status === 'kept') && (
          <button tabIndex={-1} className="task-btn task-btn-danger" onClick={handleDelete} title="Delete with files">del</button>
        )}
      </div>
    </div>
  )
}
