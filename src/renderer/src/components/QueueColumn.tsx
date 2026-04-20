import { useState, useEffect, useCallback } from 'react'
import { useQueue } from '../context/QueueContext'
import type { BackendId, Task } from '../../../shared/types'
import {
  getModelsForBackend,
  findModel,
  OPENAI_SIZES,
  GOOGLE_ASPECT_RATIOS,
  GOOGLE_IMAGE_SIZES,
  FLUX_SIZES,
  LOCAL_SIZES,
  type OpenAIModelDef,
  type GoogleModelDef,
  type FluxModelDef,
  type LocalModelDef,
  type SizePreset,
  type OpenAIQuality,
  type OpenAIOutputFormat,
  type OpenAIBackground,
  type GooglePersonGeneration
} from '../../../shared/models'
import './QueueColumn.css'

interface Props {
  backendId: BackendId
  label: string
  onSelectTask: (task: Task) => void
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--text-muted)',
  generating: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--error)'
}

export function QueueColumn({ backendId, label, onSelectTask }: Props): React.JSX.Element {
  const { tasks, enqueue } = useQueue()
  const models = getModelsForBackend(backendId as 'openai')
  const [model, setModel] = useState(models[0].id)
  const [imageCount, setImageCount] = useState(1)

  // OpenAI params
  const [quality, setQuality] = useState<OpenAIQuality>('high')
  const [outputFormat, setOutputFormat] = useState<OpenAIOutputFormat>('png')
  const [background, setBackground] = useState<OpenAIBackground>('opaque')
  const [openaiSizeIdx, setOpenaiSizeIdx] = useState(0)

  // Google params
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageSize, setImageSize] = useState('1024x1024')
  const [personGeneration, setPersonGeneration] = useState<GooglePersonGeneration>('allow_adult')
  const [numberOfImages, setNumberOfImages] = useState(1)

  // FLUX params
  const [fluxSizeIdx, setFluxSizeIdx] = useState(0)
  const [fluxSteps, setFluxSteps] = useState(40)
  const [fluxGuidance, setFluxGuidance] = useState(7)
  const [fluxSeed, setFluxSeed] = useState('')

  // Local params
  const [localSizeIdx, setLocalSizeIdx] = useState(2) // 1024x1024
  const [localSteps, setLocalSteps] = useState(4)
  const [localGuidance, setLocalGuidance] = useState(1)
  const [localSeed, setLocalSeed] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [modelExists, setModelExists] = useState<boolean | null>(null)

  const columnTasks = tasks[backendId]

  // Check local model existence when model changes
  useEffect(() => {
    if (backendId !== 'local') return
    const localModel = findModel('local', model) as LocalModelDef | undefined
    if (localModel) {
      window.electronAPI.checkLocalModel(localModel.filename).then(setModelExists)
    }
  }, [backendId, model])

  // Update defaults when model changes
  useEffect(() => {
    if (backendId === 'flux') {
      const m = findModel('flux', model) as FluxModelDef | undefined
      if (m) {
        setFluxSteps(m.stepsRange.default)
        setFluxGuidance(m.guidanceRange.default)
      }
    } else if (backendId === 'local') {
      const m = findModel('local', model) as LocalModelDef | undefined
      if (m) {
        setLocalSteps(m.stepsRange.default)
        setLocalGuidance(m.guidanceRange.default)
      }
    }
  }, [backendId, model])

  const doEnqueue = useCallback((prompt: string) => {
    if (!prompt) return

    let params: Record<string, unknown> = {}

    if (backendId === 'openai') {
      const size = OPENAI_SIZES[openaiSizeIdx]
      params = { width: size.width, height: size.height, quality, outputFormat, background }
    } else if (backendId === 'google') {
      params = { aspectRatio, imageSize, personGeneration, numberOfImages }
    } else if (backendId === 'flux') {
      const size = FLUX_SIZES[fluxSizeIdx]
      params = { width: size.width, height: size.height, steps: fluxSteps, guidance: fluxGuidance }
      if (fluxSeed) params.seed = parseInt(fluxSeed)
    } else if (backendId === 'local') {
      const size = LOCAL_SIZES[localSizeIdx]
      params = { width: size.width, height: size.height, steps: localSteps, guidance: localGuidance }
      if (localSeed) params.seed = parseInt(localSeed)
      if (negativePrompt) params.negativePrompt = negativePrompt
    }

    const count = backendId === 'google' ? 1 : (backendId === 'local' ? 1 : imageCount)

    enqueue({ prompt, backend: backendId, model, params, count })
  }, [backendId, model, imageCount, quality, outputFormat, background, openaiSizeIdx,
      aspectRatio, imageSize, personGeneration, numberOfImages,
      fluxSizeIdx, fluxSteps, fluxGuidance, fluxSeed,
      localSizeIdx, localSteps, localGuidance, localSeed, negativePrompt, enqueue])

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
    <div className="queue-column">
      <div className="column-header">{label}</div>

      <div className="column-settings">
        <div className="setting-row">
          <label>model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

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
        {backendId === 'google' && (
          <>
            <div className="setting-row">
              <label>aspect</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                {GOOGLE_ASPECT_RATIOS.map((ar) => (
                  <option key={ar.value} value={ar.value}>{ar.label}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>size</label>
              <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                {GOOGLE_IMAGE_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="setting-row">
              <label>persons</label>
              <select value={personGeneration} onChange={(e) => setPersonGeneration(e.target.value as GooglePersonGeneration)}>
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

        {/* Local parameters */}
        {backendId === 'local' && (
          <>
            {modelExists === false && (
              <div className="setting-row model-warning">
                ⚠ Model not found. Open Draw Things to download.
              </div>
            )}
            {renderSizeSelect(LOCAL_SIZES, localSizeIdx, setLocalSizeIdx)}
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

        {/* Image count (OpenAI and FLUX only) */}
        {(backendId === 'openai' || backendId === 'flux') && (
          <div className="setting-row">
            <label>images</label>
            <input
              type="number"
              value={imageCount}
              onChange={(e) => setImageCount(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              max={10}
            />
          </div>
        )}

        <button
          className="enqueue-btn"
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
          <div className="task-list-empty">
            {backendId === 'local'
              ? 'Local CLI — sequential processing only'
              : 'No tasks queued'}
          </div>
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
  )
}

function TaskItem({ task, backendId, onClick }: { task: Task; backendId: BackendId; onClick: () => void }): React.JSX.Element {
  const [showMenu, setShowMenu] = useState(false)

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setShowMenu(true)
  }

  const handleRemove = (): void => {
    setShowMenu(false)
    window.electronAPI.removeTask(backendId, task.id)
  }

  const handleDelete = (): void => {
    setShowMenu(false)
    window.electronAPI.deleteWithFiles(backendId, task.id)
  }

  const handleRetry = (): void => {
    setShowMenu(false)
    window.electronAPI.retryTask(backendId, task.id)
  }

  return (
    <div className="task-item" onClick={onClick} onContextMenu={handleContextMenu}>
      {showMenu && (
        <div className="context-menu" onMouseLeave={() => setShowMenu(false)}>
          <button onClick={handleRemove}>Remove from queue</button>
          {task.status === 'completed' && (
            <button onClick={handleDelete}>Delete with files</button>
          )}
          {task.status === 'failed' && (
            <button onClick={handleRetry}>Retry</button>
          )}
        </div>
      )}
      <div className="task-prompt" title={task.prompt}>
        {task.prompt.length > 30 ? task.prompt.slice(0, 30) + '…' : task.prompt}
      </div>
      <div className="task-status" style={{ color: STATUS_COLORS[task.status] }}>
        {task.status}
        {task.estimatedCostUsd !== null && (
          <span className="task-cost">${task.estimatedCostUsd.toFixed(2)}</span>
        )}
      </div>
      {task.status === 'failed' && task.error && (
        <div className="task-error" title={task.error}>
          {task.error}
        </div>
      )}
    </div>
  )
}
