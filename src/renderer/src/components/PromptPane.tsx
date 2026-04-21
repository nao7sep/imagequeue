import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueue } from '../context/QueueContext'
import type { BackendId, Task } from '../../../shared/types'
import './PromptPane.css'

const BACKENDS: BackendId[] = ['openai', 'imagen', 'flux', 'drawthings']

interface Props {
  selectedTask: Task | null
  previewDataUrl: string | null
}

export function PromptPane({ selectedTask, previewDataUrl }: Props): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftRef = useRef('')
  const { promptHistory } = useQueue()

  const handleSendToAll = useCallback(() => {
    if (!prompt.trim()) return
    window.dispatchEvent(new CustomEvent('enqueue-all', { detail: { prompt: prompt.trim() } }))
  }, [prompt])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key === 'Enter') {
        e.preventDefault()
        handleSendToAll()
        return
      }
      if (mod && e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        const backend = BACKENDS[parseInt(e.key) - 1]
        window.dispatchEvent(
          new CustomEvent('enqueue-single', { detail: { prompt: prompt.trim(), backend } })
        )
        return
      }
      if (mod && e.key === 'ArrowUp') {
        e.preventDefault()
        if (promptHistory.length === 0) return
        if (historyIndex === -1) draftRef.current = prompt
        const next = Math.min(historyIndex + 1, promptHistory.length - 1)
        if (next !== historyIndex) {
          setHistoryIndex(next)
          setPrompt(promptHistory[next])
        }
        return
      }
      if (mod && e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex <= -1) return
        const next = historyIndex - 1
        setHistoryIndex(next)
        setPrompt(next === -1 ? draftRef.current : promptHistory[next])
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prompt, historyIndex, promptHistory, handleSendToAll])

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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setPrompt(e.target.value)
    // Typing resets history navigation
    if (historyIndex !== -1) setHistoryIndex(-1)
  }

  return (
    <div className="prompt-pane">
      <textarea
        className="prompt-textarea"
        placeholder="Enter your image prompt..."
        value={prompt}
        onChange={handleChange}
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
