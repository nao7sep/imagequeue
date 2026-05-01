import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSelection } from '../context/SelectionContext'
import { useSettings } from '../context/SettingsContext'
import type { BackendId, Task, CliStatus, LocalModelInfo, RecommendedParams } from '../../../shared/types'
import {
  getModelsForBackend,
  findModel,
  IMAGEN_ASPECT_RATIOS,
  IMAGEN_IMAGE_SIZES,
  GROK_ASPECT_RATIOS,
  GROK_RESOLUTIONS,
  FLUX_SIZES,
  type OpenAIModelDef,
  type ImagenModelDef,
  type NanoBananaModelDef,
  type FluxModelDef,
  type SizePreset,
  type OpenAIQuality,
  type OpenAIOutputFormat,
  type OpenAIBackground,
  type ImagenPersonGeneration,
  type GrokAspectRatio,
  type GrokResolution
} from '../../../shared/models'
import { DrawThingsModelsModal } from './DrawThingsModelsModal'
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
  failed: 'var(--error)'
}

const modelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const CUSTOM_DRAWTHINGS_SIZE = 'custom'
const DRAWTHINGS_SIZE_PRESETS: SizePreset[] = [
  { label: '512x512', width: 512, height: 512 },
  { label: '768x768', width: 768, height: 768 },
  { label: '1024x1024 (Square)', width: 1024, height: 1024 },
  { label: '768x1024 (Portrait 3:4)', width: 768, height: 1024 },
  { label: '1024x768 (Landscape 4:3)', width: 1024, height: 768 },
  { label: '576x1024 (Portrait 9:16)', width: 576, height: 1024 },
  { label: '1024x576 (Landscape 16:9)', width: 1024, height: 576 },
  { label: '1024x1536 (Portrait 2:3)', width: 1024, height: 1536 },
  { label: '1536x1024 (Landscape 3:2)', width: 1536, height: 1024 },
  { label: '2048x2048 (2K Square)', width: 2048, height: 2048 },
  { label: '1536x2048 (2K Portrait 3:4)', width: 1536, height: 2048 },
  { label: '2048x1536 (2K Landscape 4:3)', width: 2048, height: 1536 },
  { label: '1152x2048 (2K Portrait 9:16)', width: 1152, height: 2048 },
  { label: '2048x1152 (2K Landscape 16:9)', width: 2048, height: 1152 }
]

function localModelName(model: LocalModelInfo): string {
  return model.name || model.file
}

function sortLocalModels(models: LocalModelInfo[]): LocalModelInfo[] {
  return [...models].sort((a, b) =>
    modelCollator.compare(
      `${localModelName(a)} ${a.file}`.toLowerCase(),
      `${localModelName(b)} ${b.file}`.toLowerCase()
    )
  )
}

export function QueueColumn({ backendId, label, hasPrompt }: Props): React.JSX.Element {
  const { tasks, enqueue } = useQueue()
  const { selection, select, clear } = useSelection()
  const { settings } = useSettings()
  const models = getModelsForBackend(backendId as 'openai')
  const defaultModel = models.find((m) => m.isDefault) ?? models[0]
  const [model, setModel] = useState(defaultModel?.id ?? '')

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
  const [quality, setQuality] = useState<OpenAIQuality>('medium')
  const [outputFormat, setOutputFormat] = useState<OpenAIOutputFormat>('png')
  const [background, setBackground] = useState<OpenAIBackground>('opaque')
  const [openaiSizeIdx, setOpenaiSizeIdx] = useState(0)

  // Google Imagen params
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageSize, setImageSize] = useState('1K')
  const [personGeneration, setPersonGeneration] = useState<ImagenPersonGeneration>('allow_all')

  // Nano Banana params
  const [nanoBananaAspectRatio, setNanoBananaAspectRatio] = useState('1:1')
  const [nanoBananaImageSize, setNanoBananaImageSize] = useState('1K')

  // FLUX params
  const [fluxSizeIdx, setFluxSizeIdx] = useState(0)
  const [fluxSteps, setFluxSteps] = useState(40)
  const [fluxGuidance, setFluxGuidance] = useState(7)
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

  const columnTasks = tasks[backendId]
  const localSizeValue = useMemo(() => {
    const preset = DRAWTHINGS_SIZE_PRESETS.find((s) => s.width === localWidth && s.height === localHeight)
    return preset ? `${preset.width}x${preset.height}` : CUSTOM_DRAWTHINGS_SIZE
  }, [localWidth, localHeight])

  const handleLocalSizeChange = (value: string): void => {
    if (value === CUSTOM_DRAWTHINGS_SIZE) return
    const preset = DRAWTHINGS_SIZE_PRESETS.find((s) => `${s.width}x${s.height}` === value)
    if (!preset) return
    setLocalWidth(preset.width)
    setLocalHeight(preset.height)
  }

  useEffect(() => {
    if (backendId !== 'drawthings') return
    const params = (
      (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
        ?.default_params as Record<string, unknown> | undefined
    ) ?? {}
    setLocalWidth((params.fallback_width as number | undefined) ?? 1024)
    setLocalHeight((params.fallback_height as number | undefined) ?? 1024)
    setLocalSteps((params.fallback_steps as number | undefined) ?? 4)
    setLocalGuidance((params.fallback_guidance as number | undefined) ?? 1)
    setLocalSeed(params.seed == null ? '' : String(params.seed))
    setNegativePrompt((params.fallback_negative_prompt as string | undefined) ?? '')
  }, [backendId, settings])

  useEffect(() => {
    if (backendId !== 'drawthings' || !model) return
    let cancelled = false
    const params = (
      (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
        ?.default_params as Record<string, unknown> | undefined
    ) ?? {}
    const fallbackWidth = (params.fallback_width as number | undefined) ?? 1024
    const fallbackHeight = (params.fallback_height as number | undefined) ?? 1024
    const fallbackSteps = (params.fallback_steps as number | undefined) ?? 4
    const fallbackGuidance = (params.fallback_guidance as number | undefined) ?? 1
    const fallbackNegativePrompt = (params.fallback_negative_prompt as string | undefined) ?? ''

    window.electronAPI.resolveRecommendation(model).then((recommendation) => {
      if (cancelled) return
      setSelectedRecommendation(recommendation)
      setLocalWidth(recommendation?.width ?? fallbackWidth)
      setLocalHeight(recommendation?.height ?? fallbackHeight)
      setLocalSteps(recommendation?.steps ?? fallbackSteps)
      setLocalGuidance(recommendation?.guidance ?? fallbackGuidance)
      setNegativePrompt(recommendation?.negativePrompt ?? fallbackNegativePrompt)
    })

    return () => { cancelled = true }
  }, [backendId, model, settings, recommendationRevision])

  // Check CLI status and load models on mount (local backend only)
  useEffect(() => {
    if (backendId !== 'drawthings') return

    const refresh = (isInitial = false): void => {
      window.electronAPI.localCheckCli().then((status) => {
        setCliStatus(status)
        if (status.installed) {
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
        }
      })
    }

    refresh(true)
    const id = window.setInterval(() => refresh(false), 30000)
    const handleFocus = (): void => refresh(false)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', handleFocus)
    }
  }, [backendId])

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

  // Update defaults when model changes
  useEffect(() => {
    if (backendId === 'openai' && openaiModelDef) {
      // Reset quality/background if the current value isn't valid for the new model
      setQuality((prev) => openaiModelDef.qualities.includes(prev) ? prev : 'medium')
      setBackground((prev) => openaiModelDef.backgrounds.includes(prev) ? prev : 'opaque')
      setOpenaiSizeIdx((prev) => prev >= openaiModelDef.sizes.length ? 0 : prev)
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
        if (m.stepsRange) setFluxSteps(m.stepsRange.default)
        if (m.guidanceRange) setFluxGuidance(m.guidanceRange.default)
      }
    }
  }, [backendId, model])

  const doEnqueue = useCallback((prompt: string) => {
    if (!prompt.trim()) return
    if (apiKeyMissing) return
    if (backendId === 'drawthings' && (!cliStatus?.installed || downloadedModels.length === 0)) return

    let params: Record<string, unknown> = {}

    if (backendId === 'openai') {
      const size = openaiModelDef!.sizes[openaiSizeIdx]
      params = { width: size.width, height: size.height, quality, outputFormat, background }
    } else if (backendId === 'imagen') {
      params = { aspectRatio, imageSize, personGeneration }
    } else if (backendId === 'flux') {
      const size = FLUX_SIZES[fluxSizeIdx]
      params = { width: size.width, height: size.height }
      if (fluxModelDef?.stepsRange) params.steps = fluxSteps
      if (fluxModelDef?.guidanceRange) params.guidance = fluxGuidance
      if (fluxSeed) params.seed = parseInt(fluxSeed)
    } else if (backendId === 'drawthings') {
      params = { width: localWidth, height: localHeight, steps: localSteps, guidance: localGuidance }
      if (localSeed) params.seed = parseInt(localSeed)
      if (negativePrompt) params.negativePrompt = negativePrompt
    } else if (backendId === 'grok') {
      params = { aspectRatio: grokAspectRatio, resolution: grokResolution }
    } else if (backendId === 'nanobanana') {
      if (nanoBananaModelDef?.supportsImageConfig) {
        params = { aspectRatio: nanoBananaAspectRatio, imageSize: nanoBananaImageSize }
      }
    }

    const count = 1

    enqueue({ prompt, backend: backendId, model, params, count })
  }, [backendId, model, quality, outputFormat, background, openaiSizeIdx,
      aspectRatio, imageSize, personGeneration,
      nanoBananaAspectRatio, nanoBananaImageSize, nanoBananaModelDef,
      fluxSizeIdx, fluxSteps, fluxGuidance, fluxSeed,
      grokAspectRatio,
      grokResolution,
      localWidth, localHeight, localSteps, localGuidance, localSeed, negativePrompt,
      apiKeyMissing, cliStatus, downloadedModels, enqueue])

  // Listen for enqueue-all and enqueue-single events from PromptPane
  useEffect(() => {
    const handleAll = (e: Event): void => {
      const prompt = (e as CustomEvent).detail.prompt
      doEnqueue(prompt)
    }
    const handleSingle = (e: Event): void => {
      const { prompt, backend } = (e as CustomEvent).detail
      if (backend === backendId) doEnqueue(prompt)
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
            {renderSizeSelect(openaiModelDef.sizes, openaiSizeIdx, setOpenaiSizeIdx)}
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
                <input type="number" value={fluxSteps} onChange={(e) => setFluxSteps(Math.max(1, parseInt(e.target.value) || 1))} min={fluxModelDef.stepsRange.min} max={fluxModelDef.stepsRange.max} />
              </div>
            )}
            {fluxModelDef?.guidanceRange && (
              <div className="setting-row">
                <label>guidance</label>
                <input type="number" value={fluxGuidance} onChange={(e) => setFluxGuidance(Math.max(fluxModelDef!.guidanceRange!.min, parseFloat(e.target.value) || fluxModelDef!.guidanceRange!.min))} min={fluxModelDef.guidanceRange.min} max={fluxModelDef.guidanceRange.max} step={0.5} />
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
                    <select value={model} onChange={(e) => setModel(e.target.value)}>
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
  const { removeTask, deleteTask } = useSelection()
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (task.status !== 'completed' || !task.baseName) return
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

  return (
    <div
      className={isSelected ? 'task-item task-item-selected' : 'task-item'}
      ref={itemRef}
      onClick={onClick}
      data-task-id={task.id}
    >
      {thumbUrl && (
        <img
          className="task-thumbnail"
          src={thumbUrl}
          alt=""
          onLoad={() => itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
        />
      )}
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
            : task.status}
        </span>
        {task.estimatedCostUsd !== null && (
          <span className="task-cost">${task.estimatedCostUsd.toFixed(2)}</span>
        )}
      </div>
      <div className="task-actions">
        {task.status === 'failed' && (
          <button className="task-btn task-btn-retry" onClick={handleRetry} title="Retry">retry</button>
        )}
        {task.status === 'completed' && task.baseName && (
          <button className="task-btn task-btn-exp" onClick={handleExport} title="Export to export folder">exp</button>
        )}
        {task.status !== 'generating' && (
          <button className="task-btn task-btn-warn" onClick={handleRemove} title="Remove from queue">rm</button>
        )}
        {task.status === 'completed' && (
          <button className="task-btn task-btn-danger" onClick={handleDelete} title="Delete with files">del</button>
        )}
      </div>
    </div>
  )
}
