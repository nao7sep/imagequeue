import { useState, useEffect, useCallback } from 'react'
import { useQueue } from '../context/QueueContext'
import type { BackendId, Task } from '../../../shared/types'
import {
  getModelsForBackend,
  findModel,
  OPENAI_SIZES,
  IMAGEN_ASPECT_RATIOS,
  IMAGEN_IMAGE_SIZES,
  FLUX_SIZES,
  DRAWTHINGS_SIZES,
  DRAWTHINGS_MODELS,
  type FluxModelDef,
  type SizePreset,
  type OpenAIQuality,
  type OpenAIOutputFormat,
  type OpenAIBackground,
  type ImagenPersonGeneration
} from '../../../shared/models'
import { DrawThingsModelsModal } from './DrawThingsModelsModal'
import './QueueColumn.css'

interface Props {
  backendId: BackendId
  label: string
  hasPrompt: boolean
  onSelectTask: (task: Task) => void
}

interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

interface CliStatus {
  installed: boolean
  version: string | null
  path: string | null
  platform: 'darwin' | 'unsupported'
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--text-muted)',
  generating: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--error)'
}

export function QueueColumn({ backendId, label, hasPrompt, onSelectTask }: Props): React.JSX.Element {
  const { tasks, enqueue } = useQueue()
  const models = getModelsForBackend(backendId as 'openai')
  const [model, setModel] = useState(models[0].id)
  const [apiKeyMissing, setApiKeyMissing] = useState(false)

  // OpenAI params
  const [quality, setQuality] = useState<OpenAIQuality>('medium')
  const [outputFormat, setOutputFormat] = useState<OpenAIOutputFormat>('png')
  const [background, setBackground] = useState<OpenAIBackground>('opaque')
  const [openaiSizeIdx, setOpenaiSizeIdx] = useState(0)

  // Google params
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageSize, setImageSize] = useState('1024x1024')
  const [personGeneration, setPersonGeneration] = useState<ImagenPersonGeneration>('allow_adult')
  const [numberOfImages, setNumberOfImages] = useState(1)

  // FLUX params
  const [fluxSizeIdx, setFluxSizeIdx] = useState(0)
  const [fluxSteps, setFluxSteps] = useState(40)
  const [fluxGuidance, setFluxGuidance] = useState(7)
  const [fluxSeed, setFluxSeed] = useState('')

  // Local params
  const [localSizeIdx, setLocalSizeIdx] = useState(2) // 1024x1024
  const [localSteps, setLocalSteps] = useState(4)
  const [localSeed, setLocalSeed] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null)
  const [downloadedModels, setDownloadedModels] = useState<LocalModelInfo[]>([])
  const [showModelsModal, setShowModelsModal] = useState(false)

  const columnTasks = tasks[backendId]

  // Check if the API key is configured; re-check when window regains focus (e.g. after saving settings)
  useEffect(() => {
    if (backendId === 'drawthings') return
    const check = async (): Promise<void> => {
      const config = await window.electronAPI.getSettings()
      const backends = config.image_backends as Record<string, Record<string, unknown>>
      const key = backends[backendId]?.api_key as string | undefined
      setApiKeyMissing(!key || key.trim() === '')
    }
    check()
    window.addEventListener('focus', check)
    window.addEventListener('settings-saved', check)
    return () => {
      window.removeEventListener('focus', check)
      window.removeEventListener('settings-saved', check)
    }
  }, [backendId])

  // Check CLI status and load models on mount (local backend only)
  useEffect(() => {
    if (backendId !== 'drawthings') return

    const refresh = (isInitial = false): void => {
      window.electronAPI.localCheckCli().then((status) => {
        setCliStatus(status)
        if (status.installed) {
          window.electronAPI.localListDownloadedModels().then((list) => {
            setDownloadedModels((prev) => {
              const prevFiles = prev.map((m) => m.file).join(',')
              const nextFiles = list.map((m) => m.file).join(',')
              if (prevFiles === nextFiles) return prev
              if (isInitial || list.length > 0) {
                setModel((cur) => (list.find((m) => m.file === cur) ? cur : list[0]?.file ?? ''))
              }
              return list
            })
          })
        }
      })
    }

    refresh(true)
    const id = window.setInterval(() => refresh(false), 5000)
    return () => window.clearInterval(id)
  }, [backendId])

  useEffect(() => {
    if (backendId !== 'drawthings') return
    const handler = (): void => setShowModelsModal(true)
    window.addEventListener('open-models-modal', handler)
    return () => window.removeEventListener('open-models-modal', handler)
  }, [backendId])

  // Update defaults when model changes
  useEffect(() => {
    if (backendId === 'flux') {
      const m = findModel('flux', model) as FluxModelDef | undefined
      if (m) {
        setFluxSteps(m.stepsRange.default)
        setFluxGuidance(m.guidanceRange.default)
      }
    } else if (backendId === 'drawthings') {
      const m = DRAWTHINGS_MODELS.find((d) => d.filename === model)
      if (m) {
        setLocalSteps(m.stepsRange.default)
      }
    }
  }, [backendId, model])

  const doEnqueue = useCallback((prompt: string) => {
    if (!prompt.trim()) return
    if (apiKeyMissing) return
    if (backendId === 'drawthings' && (!cliStatus?.installed || downloadedModels.length === 0)) return

    let params: Record<string, unknown> = {}

    if (backendId === 'openai') {
      const size = OPENAI_SIZES[openaiSizeIdx]
      params = { width: size.width, height: size.height, quality, outputFormat, background }
    } else if (backendId === 'imagen') {
      params = { aspectRatio, imageSize, personGeneration, numberOfImages }
    } else if (backendId === 'flux') {
      const size = FLUX_SIZES[fluxSizeIdx]
      params = { width: size.width, height: size.height, steps: fluxSteps, guidance: fluxGuidance }
      if (fluxSeed) params.seed = parseInt(fluxSeed)
    } else if (backendId === 'drawthings') {
      const size = DRAWTHINGS_SIZES[localSizeIdx]
      params = { width: size.width, height: size.height, steps: localSteps }
      if (localSeed) params.seed = parseInt(localSeed)
      if (negativePrompt) params.negativePrompt = negativePrompt
    } else if (backendId === 'nanobanana') {
      params = {}
    }

    const count = 1

    enqueue({ prompt, backend: backendId, model, params, count })
  }, [backendId, model, quality, outputFormat, background, openaiSizeIdx,
      aspectRatio, imageSize, personGeneration, numberOfImages,
      fluxSizeIdx, fluxSteps, fluxGuidance, fluxSeed,
      localSizeIdx, localSteps, localSeed, negativePrompt,
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
    <div className="queue-column">
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
        {backendId === 'openai' && (
          <>
            {renderSizeSelect(OPENAI_SIZES, openaiSizeIdx, setOpenaiSizeIdx)}
            <div className="setting-row">
              <label>quality</label>
              <select value={quality} onChange={(e) => setQuality(e.target.value as OpenAIQuality)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
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
                <option value="opaque">Opaque</option>
                <option value="transparent">Transparent</option>
              </select>
            </div>
          </>
        )}

        {/* Google parameters */}
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
            <div className="setting-row">
              <label>size</label>
              <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                {IMAGEN_IMAGE_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>persons</label>
              <select value={personGeneration} onChange={(e) => setPersonGeneration(e.target.value as ImagenPersonGeneration)}>
                <option value="dont_allow">Don't allow</option>
                <option value="allow_adult">Allow adult</option>
                <option value="allow_all">Allow all</option>
              </select>
            </div>
            <div className="setting-row">
              <label>images</label>
              <input type="number" value={numberOfImages} onChange={(e) => setNumberOfImages(Math.min(4, Math.max(1, parseInt(e.target.value) || 1)))} min={1} max={4} />
            </div>
          </>
        )}

        {/* FLUX parameters */}
        {backendId === 'flux' && (
          <>
            {renderSizeSelect(FLUX_SIZES, fluxSizeIdx, setFluxSizeIdx)}
            <div className="setting-row">
              <label>steps</label>
              <input type="number" value={fluxSteps} onChange={(e) => setFluxSteps(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={60} />
            </div>
            <div className="setting-row">
              <label>guidance</label>
              <input type="number" value={fluxGuidance} onChange={(e) => setFluxGuidance(Math.max(1, parseFloat(e.target.value) || 1))} min={1} max={20} step={0.5} />
            </div>
            <div className="setting-row">
              <label>seed</label>
              <input type="text" value={fluxSeed} onChange={(e) => setFluxSeed(e.target.value)} placeholder="random" />
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
                Draw Things CLI not installed.<br />
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
                        <option key={m.file} value={m.file}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="setting-row model-warning">
                    No models downloaded yet
                  </div>
                )}
                {renderSizeSelect(DRAWTHINGS_SIZES, localSizeIdx, setLocalSizeIdx)}
                <div className="setting-row">
                  <label>steps</label>
                  <input type="number" value={localSteps} onChange={(e) => setLocalSteps(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={50} />
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

      <div className="task-list">
        {columnTasks.length === 0 ? (
          <div className="task-list-empty">No tasks queued</div>
        ) : (
          columnTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              backendId={backendId}
              onClick={() => onSelectTask(task)}
            />
          ))
        )}
      </div>
    </div>

    {showModelsModal && (
      <DrawThingsModelsModal
        onClose={() => setShowModelsModal(false)}
        onModelsChanged={(updated) => {
          setDownloadedModels(updated)
          if (updated.length > 0 && !updated.find((m) => m.file === model)) {
            setModel(updated[0].file)
          }
        }}
      />
    )}
    </>
  )
}

function TaskItem({ task, backendId, onClick }: { task: Task; backendId: BackendId; onClick: () => void }): React.JSX.Element {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    if (task.status !== 'completed' || !task.baseName) return
    window.electronAPI.getImage(task.baseName).then((b64) => {
      if (b64) setThumbUrl(`data:image/png;base64,${b64}`)
    })
  }, [task.status, task.baseName])

  const handleRemove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    window.electronAPI.removeTask(backendId, task.id)
  }
  const handleDelete = (e: React.MouseEvent): void => {
    e.stopPropagation()
    window.electronAPI.deleteWithFiles(backendId, task.id)
  }
  const handleRetry = (e: React.MouseEvent): void => {
    e.stopPropagation()
    window.electronAPI.retryTask(backendId, task.id)
  }
  const handleCopyPrompt = (e: React.MouseEvent): void => {
    e.stopPropagation()
    navigator.clipboard.writeText(task.prompt)
  }

  return (
    <div className="task-item" onClick={onClick}>
      {thumbUrl && (
        <img className="task-thumbnail" src={thumbUrl} alt="" />
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
        <button className="task-btn task-btn-copy" onClick={handleCopyPrompt} title="Copy prompt">copy</button>
        {task.status !== 'generating' && (
          <button className="task-btn task-btn-warn" onClick={handleRemove} title="Remove from queue">rm</button>
        )}
        {task.status === 'completed' && (
          <button className="task-btn task-btn-danger" onClick={handleDelete} title="Delete with files">del</button>
        )}
        {task.status === 'failed' && (
          <button className="task-btn" onClick={handleRetry} title="Retry">retry</button>
        )}
      </div>
    </div>
  )
}
