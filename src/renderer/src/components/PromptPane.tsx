import { useCallback, useEffect } from 'react'
import type { BackendId, Task } from '../../../shared/types'
import './PromptPane.css'

const BACKENDS: BackendId[] = ['openai', 'imagen', 'nanobanana', 'grok', 'flux', 'drawthings']

interface Props {
  selectedTask: Task | null
  previewDataUrl: string | null
  prompt: string
  onPromptChange: (p: string) => void
}

export function PromptPane({ selectedTask, previewDataUrl, prompt, onPromptChange }: Props): React.JSX.Element {
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
      if (mod && e.key >= '1' && e.key <= '6') {
        e.preventDefault()
        const backend = BACKENDS[parseInt(e.key) - 1]
        window.dispatchEvent(
          new CustomEvent('enqueue-single', { detail: { prompt: prompt.trim(), backend } })
        )
        return
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
        onChange={(e) => onPromptChange(e.target.value)}
      />

      <div className="prompt-actions">
        <button className="send-all" disabled={!prompt.trim()} onClick={handleSendToAll}>
          Send to All
        </button>
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

      {selectedTask && (
        <div className="preview-metadata">
          <div><strong>model:</strong> {selectedTask.model}</div>
          <div><strong>status:</strong> {selectedTask.status}</div>
          <div><strong>prompt:</strong> {selectedTask.prompt}</div>
          {selectedTask.estimatedCostUsd !== null && (
            <div><strong>cost:</strong> ${selectedTask.estimatedCostUsd.toFixed(2)}</div>
          )}
          {selectedTask.durationMs !== null && (
            <div><strong>time:</strong> {(selectedTask.durationMs / 1000).toFixed(1)}s</div>
          )}
          {(() => {
            const p = selectedTask.params
            const rows: React.ReactNode[] = []
            if (p.width != null && p.height != null) {
              rows.push(<div key="size"><strong>size:</strong> {String(p.width)}×{String(p.height)}</div>)
            }
            const skip = new Set(['width', 'height'])
            const labelMap: Record<string, string> = { guidance: 'cfg', outputFormat: 'format', negativePrompt: 'negative', personGeneration: 'persons', aspectRatio: 'aspect', imageSize: 'imgSize' }
            for (const [k, v] of Object.entries(p)) {
              if (skip.has(k) || v == null || v === '') continue
              rows.push(<div key={k}><strong>{labelMap[k] ?? k}:</strong> {String(v)}</div>)
            }
            return rows
          })()}
        </div>
      )}
    </div>
  )
}
