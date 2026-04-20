import { useState, useEffect, useCallback } from 'react'
import { useQueue } from '../context/QueueContext'
import type { BackendId, Task } from '../../../shared/types'
import './PromptPane.css'

const BACKENDS: BackendId[] = ['openai', 'google', 'flux', 'local']

interface Props {
  selectedTask: Task | null
  previewDataUrl: string | null
}

export function PromptPane({ selectedTask, previewDataUrl }: Props): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const { promptHistory } = useQueue()

  const handleSendToAll = useCallback(() => {
    if (!prompt.trim()) return
    window.dispatchEvent(new CustomEvent('enqueue-all', { detail: { prompt: prompt.trim() } }))
  }, [prompt])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSendToAll()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        const backend = BACKENDS[parseInt(e.key) - 1]
        window.dispatchEvent(
          new CustomEvent('enqueue-single', { detail: { prompt: prompt.trim(), backend } })
        )
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prompt, handleSendToAll])

  // Handle "+ Queue" button requests from QueueColumn
  useEffect(() => {
    const handler = (e: Event): void => {
      const { backend } = (e as CustomEvent).detail
      if (prompt.trim()) {
        window.dispatchEvent(
          new CustomEvent('enqueue-single', { detail: { prompt: prompt.trim(), backend } })
        )
      }
    }
    window.addEventListener('request-enqueue', handler)
    return () => window.removeEventListener('request-enqueue', handler)
  }, [prompt])

  return (
    <div className="prompt-pane">
      <textarea
        className="prompt-textarea"
        placeholder="Enter your image prompt..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="prompt-actions">
        <button className="send-all" disabled={!prompt.trim()} onClick={handleSendToAll}>
          Send to All
        </button>
        <select
          className="history-select"
          value=""
          onChange={(e) => { if (e.target.value) setPrompt(e.target.value) }}
        >
          <option value="" disabled>History</option>
          {promptHistory.map((p, i) => (
            <option key={i} value={p}>{p.length > 40 ? p.slice(0, 40) + '…' : p}</option>
          ))}
        </select>
        <div className="shortcut-hints">
          <span className="shortcut-hint">⌘1</span>
          <span className="shortcut-hint">⌘2</span>
          <span className="shortcut-hint">⌘3</span>
          <span className="shortcut-hint">⌘4</span>
        </div>
      </div>

      <div className="preview-area">
        {previewDataUrl ? (
          <img className="preview-image" src={previewDataUrl} alt="Generated" />
        ) : (
          <div className="preview-placeholder">
            <p>No image selected</p>
            <p style={{ marginTop: '8px', fontSize: '11px' }}>
              Generate an image and click its thumbnail to preview
            </p>
          </div>
        )}
      </div>

      {selectedTask && selectedTask.status === 'completed' && (
        <div className="preview-metadata">
          <div><strong>model:</strong> {selectedTask.model}</div>
          <div><strong>prompt:</strong> {selectedTask.prompt}</div>
          {selectedTask.estimatedCostUsd !== null && (
            <div><strong>cost:</strong> ${selectedTask.estimatedCostUsd.toFixed(2)}</div>
          )}
          {selectedTask.durationMs !== null && (
            <div><strong>time:</strong> {(selectedTask.durationMs / 1000).toFixed(1)}s</div>
          )}
        </div>
      )}
    </div>
  )
}
