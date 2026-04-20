import { useState } from 'react'
import './PromptPane.css'

export function PromptPane(): React.JSX.Element {
  const [prompt, setPrompt] = useState('')

  return (
    <div className="prompt-pane">
      <textarea
        className="prompt-textarea"
        placeholder="Enter your image prompt..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="prompt-actions">
        <button className="send-all" disabled={!prompt.trim()}>
          Send to All
        </button>
        <button disabled>History</button>
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
