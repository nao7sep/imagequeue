import { useState, useEffect, useCallback } from 'react'
import { useQueue } from '../context/QueueContext'
import type { BackendId, Task } from '../../../shared/types'
import './QueueColumn.css'

interface Props {
  backendId: BackendId
  label: string
  onSelectTask: (task: Task) => void
}

const MODEL_OPTIONS: Record<BackendId, string[]> = {
  openai: ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'],
  google: ['imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001', 'imagen-4.0-ultra-generate-001'],
  flux: ['flux-2-max', 'flux-2-pro-preview', 'flux-2-pro', 'flux-2-flex', 'flux-2-klein-9b-preview', 'flux-2-klein-4b'],
  local: ['flux_1_schnell_q5p.ckpt', 'flux_2_klein_4b_q6p.ckpt']
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--text-muted)',
  generating: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--error)'
}

export function QueueColumn({ backendId, label, onSelectTask }: Props): React.JSX.Element {
  const { tasks, enqueue } = useQueue()
  const [model, setModel] = useState(MODEL_OPTIONS[backendId][0])
  const [imageCount, setImageCount] = useState(1)

  const columnTasks = tasks[backendId]

  const doEnqueue = useCallback((prompt: string) => {
    if (!prompt) return
    const params: Record<string, unknown> = { width: 1024, height: 1024 }
    if (backendId === 'openai') params.quality = 'high'
    if (backendId === 'flux' || backendId === 'local') params.steps = backendId === 'flux' ? 28 : 20

    enqueue({
      prompt,
      backend: backendId,
      model,
      params,
      count: backendId === 'local' ? 1 : imageCount
    })
  }, [backendId, model, imageCount, enqueue])

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

  return (
    <div className="queue-column">
      <div className="column-header">{label}</div>

      <div className="column-settings">
        <div className="setting-row">
          <label>model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS[backendId].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <label>size</label>
          <input type="text" defaultValue="1024×1024" readOnly />
        </div>

        {backendId === 'openai' && (
          <div className="setting-row">
            <label>quality</label>
            <select defaultValue="high">
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
        )}

        {(backendId === 'flux' || backendId === 'local') && (
          <div className="setting-row">
            <label>steps</label>
            <input type="number" defaultValue={backendId === 'flux' ? 28 : 20} min={1} max={50} />
          </div>
        )}

        {backendId !== 'local' && (
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
            // Grab prompt from textarea via DOM (simple cross-component read)
            const textarea = document.querySelector('.prompt-textarea') as HTMLTextAreaElement
            if (textarea?.value.trim()) doEnqueue(textarea.value.trim())
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
    </div>
  )
}
