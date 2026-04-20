import { useState, useEffect, useCallback } from 'react'
import { useQueue } from '../context/QueueContext'
import type { BackendId } from '../../../shared/types'
import './PromptPane.css'

const BACKENDS: BackendId[] = ['openai', 'google', 'flux', 'local']

export function PromptPane(): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const { promptHistory } = useQueue()

  const handleSendToAll = useCallback(() => {
    if (!prompt.trim()) return
    // Dispatched per-column via custom event; columns handle their own settings
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
        <div className="preview-placeholder">
          <p>No image selected</p>
          <p style={{ marginTop: '8px', fontSize: '11px' }}>
            Generate an image and click its thumbnail to preview
          </p>
        </div>
      </div>
    </div>
  )
}
