import { useInstalledModels } from '../hooks/useInstalledModels'
import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import type { CliStatus, DrawThingsModelParams, LocalModelInfo, RecommendedParams } from '../../../shared/types'
import type { DrawThingsParamsPersistenceState } from '../../../shared/electron-api'
import { DRAWTHINGS_SIZE_PRESETS, drawThingsDimension } from '../../../shared/models'
import { serializeError } from '../../../shared/serialize-error'
import { singleLine } from '../../../shared/textCleanup'
import { IMAGE_SEED_LIMITS, resolveImageSeed } from '../../../shared/image-seed'
import { dtFallbacksFromSettings, resolveDtParams, toDrawThingsTaskParams } from '../utils/drawThingsParams'
import { localModelName } from '../utils/localModels'
import { presentFailure } from '../utils/failurePresentation'
import { DependencyPanePointer } from './DependencyPanePointer'
import { useI18n } from '../i18n/I18nContext'
import { sizePresetLabel } from '../i18n/optionLabels'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { DRAW_THINGS_DIMENSION_RULE, DRAW_THINGS_GUIDANCE_RULE, DRAW_THINGS_STEPS_RULE, parseNumberText } from '../../../shared/number-field'
import { NumberSettingRow } from './NumberInput'

// Draw Things is the one backend that is not a parameter descriptor
// (src/renderer/src/backends): it drives a local CLI with per-model persisted
// params and recommended-parameter resolution, alongside the shared installed
// model inventory. This file owns its parameter lifecycle; QueueColumn mounts
// the hook and renders the controls.

const CUSTOM_DRAWTHINGS_SIZE = 'custom'

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
  enqueueParams: Record<string, unknown> | null
  paramsReady: boolean
  cliInstalled: boolean
  downloadedModelCount: number
  showModelsModal: boolean
  closeModelsModal: () => void
  /** Everything DrawThingsControls renders from; internal to this file's pair. */
  controls: {
    cliStatus: CliStatus | null
    downloadedModels: LocalModelInfo[]
    modelsLoadState: 'loading' | 'ready' | 'failed'
    modelsLoadError: MessageKey | null
    paramsSaveError: MessageKey | null
    paramsLoadError: MessageKey | null
    retryParamsLoad: () => void
    sizeValue: string
    width: string
    height: string
    steps: string
    guidance: string
    seed: string
    negativePrompt: string
    selectedRecommendation: RecommendedParams | null
    effectiveRecommendation: { width: number; height: number; steps: number; guidance: number; negativePrompt: string } | null
    canRestoreRecommended: boolean
    canApplyToAllModels: boolean
    onModelChange: (model: string) => void
    onSizeChange: (value: string) => void
    setWidth: (n: string) => void
    setHeight: (n: string) => void
    setSteps: (text: string) => void
    setGuidance: (text: string) => void
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
  const [authored, setAuthored] = useState(false)
  const modelsDirectory = (settings?.image_backends as { drawthings?: { models_dir?: string } } | undefined)?.drawthings?.models_dir ?? ''
  // The number fields keep what was typed (number-field-conventions). Only a
  // value their rule accepts is saved, applied to other models or queued;
  // anything else reads as NaN here and holds those back.
  const [widthText, setWidthText] = useState('1024')
  const [heightText, setHeightText] = useState('1024')
  const [stepsText, setStepsText] = useState('4')
  const [guidanceText, setGuidanceText] = useState('1')
  const localWidth = parseNumberText(widthText, DRAW_THINGS_DIMENSION_RULE) ?? NaN
  const localHeight = parseNumberText(heightText, DRAW_THINGS_DIMENSION_RULE) ?? NaN
  const localSteps = parseNumberText(stepsText, DRAW_THINGS_STEPS_RULE) ?? NaN
  const localGuidance = parseNumberText(guidanceText, DRAW_THINGS_GUIDANCE_RULE) ?? NaN
  const numbersValid = [localWidth, localHeight, localSteps, localGuidance].every(Number.isFinite)
  // Stored and recommended sizes are put on the CLI's grid as they load.
  const setLocalWidth = useCallback((value: number) => setWidthText(String(drawThingsDimension(value))), [])
  const setLocalHeight = useCallback((value: number) => setHeightText(String(drawThingsDimension(value))), [])
  const setLocalSteps = useCallback((value: number) => setStepsText(String(value)), [])
  const setLocalGuidance = useCallback((value: number) => setGuidanceText(String(value)), [])
  const [localSeed, setLocalSeed] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const inventory = useInstalledModels(active, modelsDirectory)
  const { cliStatus, models: downloadedModels, status: modelsLoadState, error: modelsLoadError } = inventory
  const [paramsSaveError, setParamsSaveError] = useState<MessageKey | null>(null)
  const [paramsLoadError, setParamsLoadError] = useState<MessageKey | null>(null)
  const [showModelsModal, setShowModelsModal] = useState(false)
  const [recommendationRevision, setRecommendationRevision] = useState(0)
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendedParams | null>(null)
  const [allModelParams, setAllModelParams] = useState<Record<string, DrawThingsModelParams>>({})
  // Controls, saves and generation share the same resolved parameter owner.
  // Model/default/recommendation changes invalidate it in the very first render.
  const [loadedParams, setLoadedParams] = useState<{
    model: string
    fallbacks: DrawThingsModelParams
    recommendationRevision: number
    modelsDirectory: string
  } | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const applyPersistenceState = (state: DrawThingsParamsPersistenceState): void => {
      if (cancelled) return
      setParamsSaveError(state.status === 'failed' ? 'drawThings.paramsSaveFailed' : null)
    }
    // Main answers the request with the current state as the first event.
    const stop = window.electronAPI.onDrawThingsParamsPersistenceState(applyPersistenceState)
    void window.electronAPI.requestDrawThingsParamsPersistenceState()
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
  const paramsReady = active && loadedParams?.model === model
    && loadedParams.fallbacks === fallbacks
    && loadedParams.recommendationRevision === recommendationRevision
    && loadedParams.modelsDirectory === modelsDirectory
  const currentDrawThingsParams = useMemo(
    () => buildDrawThingsParams(localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt),
    [localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt]
  )
  const effectiveRecommendation = useMemo(() => {
    if (!selectedRecommendation) return null
    return {
      width: drawThingsDimension(selectedRecommendation.width ?? fallbacks.width),
      height: drawThingsDimension(selectedRecommendation.height ?? fallbacks.height),
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
    setAuthored(true)
    setLocalWidth(preset.width)
    setLocalHeight(preset.height)
  }, [])

  useEffect(() => {
    if (!active || modelsLoadState !== 'ready' || downloadedModels.length === 0) return
    setModel((current) => downloadedModels.some((item) => item.file === current) ? current : downloadedModels[0].file)
  }, [active, modelsLoadState, downloadedModels, setModel])

  const onRestoreRecommended = useCallback((): void => {
    if (!effectiveRecommendation) return
    setAuthored(true)
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
    if (!active || !numbersValid || downloadedModels.length <= 1) return false
    return downloadedModels.some((m) => {
      if (m.file === model) return false
      const entry = Object.hasOwn(allModelParams, m.file) ? allModelParams[m.file] : undefined
      if (!entry) return true
      return entry.width !== localWidth
        || entry.height !== localHeight
        || entry.steps !== localSteps
        || entry.guidance !== localGuidance
    })
  }, [active, numbersValid, downloadedModels, model, allModelParams, localWidth, localHeight, localSteps, localGuidance])

  const onApplyToAllModels = useCallback(async (): Promise<void> => {
    if (!active || !numbersValid || downloadedModels.length === 0) return
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
      setParamsSaveError('drawThings.paramsSaveFailed')
      return
    }
    await refreshAllModelParams()
  }, [
    active,
    numbersValid,
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
    setLoadedParams(null)
  }, [active, fallbacks])

  useEffect(() => {
    if (!active || !model) return
    let cancelled = false
    setLoadedParams(null)
    setAuthored(false)
    setParamsLoadError(null)

    window.electronAPI.dtGetModelParams(model).then(async (saved) => {
      const recommendation = await window.electronAPI.resolveRecommendation(model).catch((error) => {
        if (!saved) throw error
        logSaveError('load optional Draw Things recommendation', error, { model })
        return null
      })
      return { saved, recommendation }
    }).then(({ saved, recommendation }) => {
      if (cancelled) return
      setSelectedRecommendation(recommendation)
      const resolved = resolveDtParams(saved, recommendation, fallbacks)
      setLocalWidth(resolved.width)
      setLocalHeight(resolved.height)
      setLocalSteps(resolved.steps)
      setLocalGuidance(resolved.guidance)
      setLocalSeed(resolved.seed)
      setNegativePrompt(resolved.negativePrompt)
      setLoadedParams({ model, fallbacks, recommendationRevision, modelsDirectory })
      setParamsLoadError(null)
    }).catch((error) => {
      if (cancelled) return
      setLoadedParams(null)
      setParamsLoadError('drawThings.paramsLoadFailed')
      logSaveError('load Draw Things model parameters and recommendation', error, { model })
    })

    return () => { cancelled = true }
  }, [active, model, fallbacks, recommendationRevision, modelsDirectory])

  // A managed-dependency change (CLI installed/updated, or configs.json
  // downloaded/updated from the Dependencies modal) re-resolves this column: the
  // model list and CLI availability may have changed, and a new configs.json
  // changes the per-model recommended parameters.
  useEffect(() => {
    if (!active) return
    const openModels = (): void => setShowModelsModal(true)
    const dependenciesChanged = (): void => {
      setRecommendationRevision((value) => value + 1)
    }
    window.addEventListener('open-models-modal', openModels)
    window.addEventListener('dependencies-changed', dependenciesChanged)
    return () => {
      window.removeEventListener('open-models-modal', openModels)
      window.removeEventListener('dependencies-changed', dependenciesChanged)
    }
  }, [active])

  // Persist only authored edits; resolving defaults is not authorship. The main process coalesces
  // rapid writes and drains pending writes on `before-quit`, so we don't
  // debounce here. The resolved-owner gate also covers recommendation/default
  // reloads, so stale values cannot be written or used for generation.
  useEffect(() => {
    if (!paramsReady || !numbersValid || !authored) return
    setAuthored(false)
    window.electronAPI.dtSaveModelParams(model, currentDrawThingsParams)
      .catch((err) => {
        logSaveError('autosave Draw Things model parameters', err, { model })
        setParamsSaveError('drawThings.paramsSaveFailed')
      })
  }, [paramsReady, numbersValid, authored, model, currentDrawThingsParams])

  const enqueueParams = useMemo<Record<string, unknown> | null>(() => {
    if (!numbersValid) return null
    // Seed/negative gating shared with Advanced Prompting (drawThingsParams.ts).
    return toDrawThingsTaskParams(
      buildDrawThingsParams(localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt)
    )
  }, [numbersValid, localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt])

  const closeModelsModal = useCallback(() => setShowModelsModal(false), [])

  return {
    enqueueParams,
    paramsReady,
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
      paramsLoadError,
      retryParamsLoad: () => setRecommendationRevision((value) => value + 1),
      sizeValue,
      width: widthText,
      height: heightText,
      steps: stepsText,
      guidance: guidanceText,
      seed: localSeed,
      negativePrompt,
      selectedRecommendation,
      effectiveRecommendation,
      canRestoreRecommended,
      canApplyToAllModels,
      onModelChange,
      onSizeChange,
      setWidth: (value) => { setAuthored(true); setWidthText(value) },
      setHeight: (value) => { setAuthored(true); setHeightText(value) },
      setSteps: (value) => { setAuthored(true); setStepsText(value) },
      setGuidance: (value) => { setAuthored(true); setGuidanceText(value) },
      setSeed: (value) => { setAuthored(true); setLocalSeed(value) },
      setNegativePrompt: (value) => { setAuthored(true); setNegativePrompt(value) },
      onRestoreRecommended,
      onApplyToAllModels,
    },
  }
}

export function DrawThingsControls({ model, column }: { model: string; column: DrawThingsColumn }): React.JSX.Element {
  const fieldId = useId()
  const c = column.controls
  const seedValid = resolveImageSeed(c.seed, 'drawthings').valid
  const { t } = useI18n()
  return (
    <>
      {/* The single pointer to the Dependencies modal — the only attention
          surface for the CLI and configs.json. It decides its own
          visibility (silent when both are fine). */}
      <DependencyPanePointer />
      {c.paramsSaveError && (
        <div className="drawthings-save-error" role="alert">{t(c.paramsSaveError)}</div>
      )}
      {c.paramsLoadError && (
        <div className="drawthings-save-error" role="alert">
          {t(c.paramsLoadError)}
          <button type="button" onClick={c.retryParamsLoad}>{t('common.retry')}</button>
        </div>
      )}
      {c.modelsLoadState === 'loading' && !c.cliStatus && (
        <div className="setting-row model-status">{t('drawThings.checking')}</div>
      )}
      {c.modelsLoadState === 'failed' && (
        <div className="drawthings-save-error" role="alert">
          {t(c.modelsLoadError ?? 'drawThings.modelsLoadFailed')}
        </div>
      )}
      {c.cliStatus && c.cliStatus.installed && (
        <>
          {c.downloadedModels.length > 0 ? (
            <div className="setting-row">
              <label htmlFor={`${fieldId}-model`}>{t('column.model')}</label>
              <select id={`${fieldId}-model`} value={model} onChange={(e) => c.onModelChange(e.target.value)}>
                {c.downloadedModels.map((m) => (
                  <option key={m.file} value={m.file}>{localModelName(m)}</option>
                ))}
              </select>
            </div>
          ) : c.modelsLoadState === 'ready' ? (
            <div className="setting-row model-warning">
              {t('drawThings.noModels')}
            </div>
          ) : null}
          <div className="setting-row">
            <label htmlFor={`${fieldId}-size`}>{t('backend.size')}</label>
            <select id={`${fieldId}-size`} disabled={!column.paramsReady} value={c.sizeValue} onChange={(e) => c.onSizeChange(e.target.value)}>
              {DRAWTHINGS_SIZE_PRESETS.map((s) => (
                <option key={`${s.width}x${s.height}`} value={`${s.width}x${s.height}`}>{sizePresetLabel(t, s)}</option>
              ))}
              <option value={CUSTOM_DRAWTHINGS_SIZE}>{t('backend.customSize')}</option>
            </select>
          </div>
          <NumberSettingRow id={`${fieldId}-width`} label={t('backend.width')} disabled={!column.paramsReady} rule={DRAW_THINGS_DIMENSION_RULE} text={c.width} onText={c.setWidth} />
          <NumberSettingRow id={`${fieldId}-height`} label={t('backend.height')} disabled={!column.paramsReady} rule={DRAW_THINGS_DIMENSION_RULE} text={c.height} onText={c.setHeight} />
          <NumberSettingRow id={`${fieldId}-steps`} label={t('backend.steps')} disabled={!column.paramsReady} rule={DRAW_THINGS_STEPS_RULE} text={c.steps} onText={c.setSteps} />
          <NumberSettingRow id={`${fieldId}-guidance`} label={t('backend.guidance')} disabled={!column.paramsReady} rule={DRAW_THINGS_GUIDANCE_RULE} text={c.guidance} onText={c.setGuidance} />
          {c.canApplyToAllModels && (
            <button
              type="button"
              className="open-models-btn drawthings-recommendation-btn"
              disabled={!column.paramsReady}
              title={t('drawThings.applyToAllHint')}
              onClick={() => { void c.onApplyToAllModels() }}
            >
              {t('drawThings.applyToAll')}
            </button>
          )}
          <div className="setting-row">
            <label htmlFor={`${fieldId}-seed`}>{t('backend.seed')}</label>
            <input id={`${fieldId}-seed`} disabled={!column.paramsReady} type="text" aria-invalid={!seedValid} aria-describedby={!seedValid ? `${fieldId}-seed-error` : undefined} value={c.seed} onChange={(e) => c.setSeed(e.target.value)} placeholder={t('backend.seedPlaceholder')} />
          </div>
          {!seedValid && <div id={`${fieldId}-seed-error`} className="drawthings-save-error" role="alert">{t('backend.invalidSeed', IMAGE_SEED_LIMITS.drawthings)}</div>}
          <div className="setting-row">
            <label htmlFor={`${fieldId}-negative`}>{t('drawThings.negative')}</label>
            <input id={`${fieldId}-negative`} disabled={!column.paramsReady} type="text" value={c.negativePrompt} onChange={(e) => c.setNegativePrompt(e.target.value)} placeholder={t('drawThings.negativePlaceholder')} />
          </div>
          {c.canRestoreRecommended && c.effectiveRecommendation && (
            <button
              type="button"
              className="open-models-btn drawthings-recommendation-btn"
              disabled={!column.paramsReady}
              title={t('drawThings.useRecommendedHint', { model: c.selectedRecommendation?.matchName ?? model })}
              onClick={c.onRestoreRecommended}
            >
              {t('drawThings.useRecommended')}
            </button>
          )}
        </>
      )}
    </>
  )
}
