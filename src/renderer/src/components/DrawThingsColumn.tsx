import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { CliStatus, DrawThingsModelParams, LocalModelInfo, RecommendedParams } from '../../../shared/types'
import {
  DRAW_THINGS_PARAMS_PERSISTENCE_ERROR,
  type DrawThingsParamsPersistenceState,
} from '../../../shared/electron-api'
import { STANDARD_SIZE_PRESETS, type SizePreset } from '../../../shared/models'
import { serializeError } from '../../../shared/serialize-error'
import { singleLine } from '../../../shared/textCleanup'
import { dtFallbacksFromSettings, resolveDtParams, toDrawThingsTaskParams } from '../utils/drawThingsParams'
import { localModelName, sortLocalModels } from '../utils/localModels'
import { presentFailure } from '../utils/failurePresentation'
import { DependencyPanePointer } from './DependencyPanePointer'

// Draw Things is the one backend that is not a parameter descriptor
// (src/renderer/src/backends): it drives a local CLI with per-model persisted
// params, recommended-parameter resolution, and its own model list — a
// different lifecycle, not a wider parameter set. This file owns that whole
// lifecycle; QueueColumn only mounts the hook and renders the controls.

const CUSTOM_DRAWTHINGS_SIZE = 'custom'
const DRAWTHINGS_SIZE_PRESETS: SizePreset[] = STANDARD_SIZE_PRESETS

// Retains full diagnostic detail for renderer-side persistence failures. The
// column separately owns the concise recovery result; neither surface replaces
// the other.
function logSaveError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  void window.electronAPI.appLog('error', 'Renderer save failed', {
    context,
    error: serializeError(err),
    ...extra,
  }).catch((logError) => {
    console.error('Failed to forward renderer save error to the session log', logError)
  })
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

export interface DrawThingsColumn {
  /** The DT branch of the column's enqueue params (memo-stable). */
  enqueueParams: Record<string, unknown>
  cliInstalled: boolean
  downloadedModelCount: number
  showModelsModal: boolean
  closeModelsModal: () => void
  /** Everything DrawThingsControls renders from; internal to this file's pair. */
  controls: {
    cliStatus: CliStatus | null
    downloadedModels: LocalModelInfo[]
    modelsLoadState: 'loading' | 'ready' | 'failed'
    modelsLoadError: string
    paramsSaveError: string
    sizeValue: string
    width: number
    height: number
    steps: number
    guidance: number
    seed: string
    negativePrompt: string
    selectedRecommendation: RecommendedParams | null
    effectiveRecommendation: { width: number; height: number; steps: number; guidance: number; negativePrompt: string } | null
    canRestoreRecommended: boolean
    canApplyToAllModels: boolean
    onModelChange: (model: string) => void
    onSizeChange: (value: string) => void
    setWidth: (n: number) => void
    setHeight: (n: number) => void
    setSteps: (n: number) => void
    setGuidance: (n: number) => void
    setSeed: (s: string) => void
    setNegativePrompt: (s: string) => void
    onRestoreRecommended: () => void
    onApplyToAllModels: () => Promise<void>
  }
}

export function useDrawThingsColumn({
  active,
  model,
  setModel,
  settings,
}: {
  active: boolean
  model: string
  setModel: (updater: string | ((current: string) => string)) => void
  settings: Record<string, unknown> | null
}): DrawThingsColumn {
  const [localWidth, setLocalWidth] = useState(1024)
  const [localHeight, setLocalHeight] = useState(1024)
  const [localSteps, setLocalSteps] = useState(4)
  const [localGuidance, setLocalGuidance] = useState(1)
  const [localSeed, setLocalSeed] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null)
  const [downloadedModels, setDownloadedModels] = useState<LocalModelInfo[]>([])
  const [modelsLoadState, setModelsLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [modelsLoadError, setModelsLoadError] = useState('')
  const [paramsSaveError, setParamsSaveError] = useState('')
  const [showModelsModal, setShowModelsModal] = useState(false)
  const [recommendationRevision, setRecommendationRevision] = useState(0)
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendedParams | null>(null)
  const [allModelParams, setAllModelParams] = useState<Record<string, DrawThingsModelParams>>({})
  // Tracks which model's saved params are currently reflected in local state.
  // The autosave effect uses this to skip writes between a model switch and
  // the new model's load completing, so we never persist model A's params
  // under model B's key.
  const [loadedModel, setLoadedModel] = useState('')
  const persistenceRevision = useRef(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const applyPersistenceState = (state: DrawThingsParamsPersistenceState): void => {
      if (cancelled) return
      persistenceRevision.current += 1
      setParamsSaveError(state.status === 'failed' ? state.message : '')
    }
    const stop = window.electronAPI.onDrawThingsParamsPersistenceState(applyPersistenceState)
    const revision = persistenceRevision.current
    void window.electronAPI.getDrawThingsParamsPersistenceState()
      .then((state) => {
        if (!cancelled && revision === persistenceRevision.current) applyPersistenceState(state)
      })
      .catch((error) => logSaveError('load Draw Things parameter persistence state', error))
    return () => {
      cancelled = true
      stop()
    }
  }, [active])

  // One shared derivation with Advanced Prompting (drawThingsParams.ts) — the
  // two surfaces had grown divergent copies of this precedence.
  const fallbacksRaw = dtFallbacksFromSettings(settings as Record<string, unknown> | null)
  const fallbacks = useMemo(
    () => fallbacksRaw,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      fallbacksRaw.width, fallbacksRaw.height, fallbacksRaw.steps,
      fallbacksRaw.guidance, fallbacksRaw.seed, fallbacksRaw.negativePrompt,
    ],
  )
  const currentDrawThingsParams = useMemo(
    () => buildDrawThingsParams(localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt),
    [localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt]
  )
  const effectiveRecommendation = useMemo(() => {
    if (!selectedRecommendation) return null
    return {
      width: selectedRecommendation.width ?? fallbacks.width,
      height: selectedRecommendation.height ?? fallbacks.height,
      steps: selectedRecommendation.steps ?? fallbacks.steps,
      guidance: selectedRecommendation.guidance ?? fallbacks.guidance,
      negativePrompt: selectedRecommendation.negativePrompt ?? fallbacks.negativePrompt,
    }
  }, [selectedRecommendation, fallbacks])
  const sizeValue = useMemo(() => {
    const preset = DRAWTHINGS_SIZE_PRESETS.find((s) => s.width === localWidth && s.height === localHeight)
    return preset ? `${preset.width}x${preset.height}` : CUSTOM_DRAWTHINGS_SIZE
  }, [localWidth, localHeight])
  const canRestoreRecommended = effectiveRecommendation !== null && (
    localWidth !== effectiveRecommendation.width ||
    localHeight !== effectiveRecommendation.height ||
    localSteps !== effectiveRecommendation.steps ||
    localGuidance !== effectiveRecommendation.guidance ||
    negativePrompt !== effectiveRecommendation.negativePrompt
  )

  const onSizeChange = useCallback((value: string): void => {
    if (value === CUSTOM_DRAWTHINGS_SIZE) return
    const preset = DRAWTHINGS_SIZE_PRESETS.find((s) => `${s.width}x${s.height}` === value)
    if (!preset) return
    setLocalWidth(preset.width)
    setLocalHeight(preset.height)
  }, [])

  const refreshDrawThingsModels = useCallback(async (isInitial = false): Promise<void> => {
    if (!active) return
    if (isInitial) setModelsLoadState('loading')
    setModelsLoadError('')
    try {
      const status = await window.electronAPI.localCheckCli()
      setCliStatus(status)
      if (!status.installed) {
        setDownloadedModels([])
        setModelsLoadState('ready')
        return
      }
      const list = await window.electronAPI.localListDownloadedModels()
      const sortedList = sortLocalModels(list)
      setDownloadedModels((prev) => {
        const prevFiles = prev.map((m) => m.file).join(',')
        const nextFiles = sortedList.map((m) => m.file).join(',')
        if (prevFiles === nextFiles) return prev
        if (isInitial || sortedList.length > 0) {
          setModel((cur: string) => (sortedList.find((m) => m.file === cur) ? cur : sortedList[0]?.file ?? ''))
        }
        return sortedList
      })
      setModelsLoadState('ready')
    } catch (error) {
      setModelsLoadError(presentFailure('drawthings-models-load', error))
      setModelsLoadState('failed')
    }
  }, [active, setModel])

  const onRestoreRecommended = useCallback((): void => {
    if (!effectiveRecommendation) return
    setLocalWidth(effectiveRecommendation.width)
    setLocalHeight(effectiveRecommendation.height)
    setLocalSteps(effectiveRecommendation.steps)
    setLocalGuidance(effectiveRecommendation.guidance)
    setNegativePrompt(effectiveRecommendation.negativePrompt)
  }, [effectiveRecommendation])

  const refreshAllModelParams = useCallback(async (): Promise<void> => {
    if (!active) return
    const store = await window.electronAPI.dtGetAllModelParams()
    setAllModelParams(store)
  }, [active])

  const canApplyToAllModels = useMemo(() => {
    if (!active || downloadedModels.length <= 1) return false
    return downloadedModels.some((m) => {
      if (m.file === model) return false
      const entry = allModelParams[m.file]
      if (!entry) return true
      return entry.width !== localWidth
        || entry.height !== localHeight
        || entry.steps !== localSteps
        || entry.guidance !== localGuidance
    })
  }, [active, downloadedModels, model, allModelParams, localWidth, localHeight, localSteps, localGuidance])

  const onApplyToAllModels = useCallback(async (): Promise<void> => {
    if (!active || downloadedModels.length === 0) return
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
      setParamsSaveError(DRAW_THINGS_PARAMS_PERSISTENCE_ERROR)
      return
    }
    await refreshAllModelParams()
  }, [
    active,
    downloadedModels,
    localWidth,
    localHeight,
    localSteps,
    localGuidance,
    refreshAllModelParams,
  ])

  const onModelChange = useCallback((nextModel: string): void => {
    setModel(nextModel)
    void refreshAllModelParams()
  }, [setModel, refreshAllModelParams])

  useEffect(() => {
    if (!active) return
    void refreshAllModelParams()
  }, [active, downloadedModels, refreshAllModelParams])

  useEffect(() => {
    if (!active) return
    setLocalWidth(fallbacks.width)
    setLocalHeight(fallbacks.height)
    setLocalSteps(fallbacks.steps)
    setLocalGuidance(fallbacks.guidance)
    setLocalSeed(fallbacks.seed)
    setNegativePrompt(fallbacks.negativePrompt)
    // Block autosave while these transient fallback values sit in local state;
    // the load effect re-opens the gate after the model's saved params land.
    setLoadedModel('')
  }, [active, fallbacks])

  useEffect(() => {
    if (!active || !model) return
    let cancelled = false

    Promise.all([
      window.electronAPI.dtGetModelParams(model),
      window.electronAPI.resolveRecommendation(model),
    ]).then(([saved, recommendation]) => {
      if (cancelled) return
      setSelectedRecommendation(recommendation)
      const resolved = resolveDtParams(saved, recommendation, fallbacks)
      setLocalWidth(resolved.width)
      setLocalHeight(resolved.height)
      setLocalSteps(resolved.steps)
      setLocalGuidance(resolved.guidance)
      setLocalSeed(resolved.seed)
      setNegativePrompt(resolved.negativePrompt)
      setLoadedModel(model)
      setParamsSaveError('')
    }).catch((error) => {
      if (cancelled) return
      setLoadedModel('')
      setParamsSaveError('The selected model’s saved parameters could not be loaded. Choose the model again to retry; no parameters were changed.')
      logSaveError('load Draw Things model parameters and recommendation', error, { model })
    })

    return () => { cancelled = true }
  }, [active, model, fallbacks, recommendationRevision])

  // Check CLI status and load models on mount (local backend only)
  useEffect(() => {
    if (!active) return
    void refreshDrawThingsModels(true)
    const id = window.setInterval(() => { void refreshDrawThingsModels(false) }, 30000)
    const handleFocus = (): void => { void refreshDrawThingsModels(false) }
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', handleFocus)
    }
  }, [active, refreshDrawThingsModels])

  useEffect(() => {
    if (!active) return
    return window.electronAPI.onCliJobStatus((event) => {
      if (event.status === 'exited' || event.status === 'killed') {
        void refreshDrawThingsModels(false)
      }
    })
  }, [active, refreshDrawThingsModels])

  // A managed-dependency change (CLI installed/updated, or configs.json
  // downloaded/updated from the Dependencies modal) re-resolves this column: the
  // model list and CLI availability may have changed, and a new configs.json
  // changes the per-model recommended parameters.
  useEffect(() => {
    if (!active) return
    const openModels = (): void => setShowModelsModal(true)
    const dependenciesChanged = (): void => {
      setRecommendationRevision((value) => value + 1)
      void refreshDrawThingsModels(false)
    }
    window.addEventListener('open-models-modal', openModels)
    window.addEventListener('dependencies-changed', dependenciesChanged)
    return () => {
      window.removeEventListener('open-models-modal', openModels)
      window.removeEventListener('dependencies-changed', dependenciesChanged)
    }
  }, [active, refreshDrawThingsModels])

  // Autosave Draw Things params on every change. The main process coalesces
  // rapid writes and drains pending writes on `before-quit`, so we don't
  // debounce here. The `loadedModel === model` gate prevents writing model A's
  // params under model B's key during the brief window between a model switch
  // and the new model's load completing.
  useEffect(() => {
    if (!active || !model) return
    if (loadedModel !== model) return
    window.electronAPI.dtSaveModelParams(model, currentDrawThingsParams)
      .catch((err) => {
        logSaveError('autosave Draw Things model parameters', err, { model })
        setParamsSaveError(DRAW_THINGS_PARAMS_PERSISTENCE_ERROR)
      })
  }, [active, model, loadedModel, currentDrawThingsParams])

  const enqueueParams = useMemo<Record<string, unknown>>(() => {
    // Seed/negative gating shared with Advanced Prompting (drawThingsParams.ts).
    return toDrawThingsTaskParams(
      buildDrawThingsParams(localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt)
    )
  }, [localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt])

  const closeModelsModal = useCallback(() => setShowModelsModal(false), [])

  return {
    enqueueParams,
    cliInstalled: !!cliStatus?.installed,
    downloadedModelCount: downloadedModels.length,
    showModelsModal,
    closeModelsModal,
    controls: {
      cliStatus,
      downloadedModels,
      modelsLoadState,
      modelsLoadError,
      paramsSaveError,
      sizeValue,
      width: localWidth,
      height: localHeight,
      steps: localSteps,
      guidance: localGuidance,
      seed: localSeed,
      negativePrompt,
      selectedRecommendation,
      effectiveRecommendation,
      canRestoreRecommended,
      canApplyToAllModels,
      onModelChange,
      onSizeChange,
      setWidth: setLocalWidth,
      setHeight: setLocalHeight,
      setSteps: setLocalSteps,
      setGuidance: setLocalGuidance,
      setSeed: setLocalSeed,
      setNegativePrompt,
      onRestoreRecommended,
      onApplyToAllModels,
    },
  }
}

export function DrawThingsControls({ model, column }: { model: string; column: DrawThingsColumn }): React.JSX.Element {
  const c = column.controls
  return (
    <>
      {/* The single pointer to the Dependencies modal — the only attention
          surface for the CLI and configs.json. It decides its own
          visibility (silent when both are fine). */}
      <DependencyPanePointer />
      {c.paramsSaveError && (
        <div className="drawthings-save-error" role="alert">{c.paramsSaveError}</div>
      )}
      {c.modelsLoadState === 'loading' && !c.cliStatus && (
        <div className="setting-row model-warning">Checking Draw Things…</div>
      )}
      {c.modelsLoadState === 'failed' && (
        <div className="setting-row model-warning" role="alert">
          Couldn’t load Draw Things models{c.modelsLoadError ? `: ${c.modelsLoadError}` : '.'}
        </div>
      )}
      {c.cliStatus && c.cliStatus.installed && (
        <>
          {c.downloadedModels.length > 0 ? (
            <div className="setting-row">
              <label>Model</label>
              <select value={model} onChange={(e) => c.onModelChange(e.target.value)}>
                {c.downloadedModels.map((m) => (
                  <option key={m.file} value={m.file}>{localModelName(m)}</option>
                ))}
              </select>
            </div>
          ) : c.modelsLoadState === 'ready' ? (
            <div className="setting-row model-warning">
              No models downloaded yet
            </div>
          ) : null}
          <div className="setting-row">
            <label>Size</label>
            <select value={c.sizeValue} onChange={(e) => c.onSizeChange(e.target.value)}>
              {DRAWTHINGS_SIZE_PRESETS.map((s) => (
                <option key={`${s.width}x${s.height}`} value={`${s.width}x${s.height}`}>{s.label}</option>
              ))}
              <option value={CUSTOM_DRAWTHINGS_SIZE}>Custom width/height</option>
            </select>
          </div>
          <div className="setting-row">
            <label>Width</label>
            <input type="number" value={c.width} onChange={(e) => c.setWidth(Math.max(64, parseInt(e.target.value) || 64))} min={64} step={64} />
          </div>
          <div className="setting-row">
            <label>Height</label>
            <input type="number" value={c.height} onChange={(e) => c.setHeight(Math.max(64, parseInt(e.target.value) || 64))} min={64} step={64} />
          </div>
          <div className="setting-row">
            <label>Steps</label>
            <input type="number" value={c.steps} onChange={(e) => c.setSteps(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={50} />
          </div>
          <div className="setting-row">
            <label>Guidance</label>
            <input type="number" value={c.guidance} onChange={(e) => c.setGuidance(Math.max(1, parseFloat(e.target.value) || 1))} min={1} max={20} step={0.5} />
          </div>
          {c.canApplyToAllModels && (
            <button
              type="button"
              className="open-models-btn drawthings-recommendation-btn"
              title="Copy width, height, steps, and guidance to every downloaded Draw Things model. Each model's seed and negative prompt are preserved."
              onClick={() => { void c.onApplyToAllModels() }}
            >
              Apply to all models
            </button>
          )}
          <div className="setting-row">
            <label>Seed</label>
            <input type="text" value={c.seed} onChange={(e) => c.setSeed(e.target.value)} placeholder="random" />
          </div>
          <div className="setting-row">
            <label>Neg.</label>
            <input type="text" value={c.negativePrompt} onChange={(e) => c.setNegativePrompt(e.target.value)} placeholder="negative prompt" />
          </div>
          {c.canRestoreRecommended && c.effectiveRecommendation && (
            <button
              type="button"
              className="open-models-btn drawthings-recommendation-btn"
              title={`Restore Draw Things recommended parameters for ${c.selectedRecommendation?.matchName ?? model}`}
              onClick={c.onRestoreRecommended}
            >
              Use recommended
            </button>
          )}
        </>
      )}
    </>
  )
}
