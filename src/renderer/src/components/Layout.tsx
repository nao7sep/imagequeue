import { useState, useEffect, useRef } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { Settings } from './Settings'
import { Modal } from './Modal'
import './Layout.css'
import { useSelection } from '../context/SelectionContext'

const ALL_BACKENDS = [
  { id: 'openai' as const, label: 'GPT Image' },
  { id: 'imagen' as const, label: 'Google Imagen' },
  { id: 'nanobanana' as const, label: 'Nano Banana' },
  { id: 'grok' as const, label: 'Grok Imagine' },
  { id: 'flux' as const, label: 'FLUX' },
  { id: 'drawthings' as const, label: 'Draw Things' }
]

// Draw Things CLI is macOS-only — show it only on macOS
const BACKENDS = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  ? ALL_BACKENDS
  : ALL_BACKENDS.filter((b) => b.id !== 'drawthings')

type Overlay = 'settings' | 'shortcuts' | 'about' | null

export function Layout(): React.JSX.Element {
  const { selectedTask, clear } = useSelection()
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  // Cmd+, opens Settings. Escape (when no Modal/menu intercepts) clears
  // the menu / clears selection. Modals own their own Escape handling
  // (see Modal.tsx) and stop the event in the capture phase.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (showMenu) {
          setShowMenu(false)
        } else if (!overlay) {
          clear()
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setOverlay((o) => (o === 'settings' ? null : 'settings'))
        setShowMenu(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [overlay, showMenu, clear])

  // Load image data when a completed task is selected
  useEffect(() => {
    if (!selectedTask || selectedTask.status !== 'completed' || !selectedTask.baseName) {
      setPreviewDataUrl(null)
      return
    }

    window.electronAPI.getImage(selectedTask.baseName).then((result) => {
      if (result) {
        const mime = result.ext === 'jpg' ? 'image/jpeg' : `image/${result.ext}`
        setPreviewDataUrl(`data:${mime};base64,${result.data}`)
      } else {
        setPreviewDataUrl(null)
      }
    })
  }, [selectedTask])

  // Open the fullscreen viewer window when Space is pressed on a completed task.
  useEffect(() => {
    const handler = (): void => {
      if (previewDataUrl) void window.electronAPI.openViewer(previewDataUrl)
    }
    window.addEventListener('viewer:toggle', handler)
    return () => window.removeEventListener('viewer:toggle', handler)
  }, [previewDataUrl])

  const openOverlay = (o: Overlay): void => {
    setShowMenu(false)
    setOverlay(o)
  }

  const isMac = window.electronAPI.platform === 'darwin'
  const mod = isMac ? 'Cmd+' : 'Ctrl+'

  return (
    <div className="layout">
      {overlay === 'settings' && (
        <Settings onClose={() => setOverlay(null)} />
      )}
      {overlay === 'shortcuts' && (
        <Modal title="Keyboard Shortcuts" className="shortcuts-modal-box" onClose={() => setOverlay(null)}>
          <div className="shortcuts-body">
            <div className="shortcut-group">
              <p className="shortcut-group-name">Sending</p>
              <div className="shortcut-list">
                <div className="shortcut-item"><span>Send to all backends</span><kbd>{mod}Enter</kbd></div>
                <div className="shortcut-item"><span>Send to GPT Image</span><kbd>{mod}1</kbd></div>
                <div className="shortcut-item"><span>Send to Google Imagen</span><kbd>{mod}2</kbd></div>
                <div className="shortcut-item"><span>Send to Nano Banana</span><kbd>{mod}3</kbd></div>
                <div className="shortcut-item"><span>Send to Grok Imagine</span><kbd>{mod}4</kbd></div>
                <div className="shortcut-item"><span>Send to FLUX</span><kbd>{mod}5</kbd></div>
                {isMac && (
                  <div className="shortcut-item"><span>Send to Draw Things</span><kbd>{mod}6</kbd></div>
                )}
              </div>
            </div>
            <div className="shortcut-group">
              <p className="shortcut-group-name">Queue Navigation</p>
              <div className="shortcut-list">
                <div className="shortcut-item"><span>Move up / down within column</span><kbd>↑ / ↓</kbd></div>
                <div className="shortcut-item"><span>Move to nearest task in adjacent column</span><kbd>← / →</kbd></div>
                <div className="shortcut-item"><span>Open fullscreen image viewer (Space or Esc to close)</span><kbd>Space</kbd></div>
                <div className="shortcut-item"><span>Remove task from queue (keep files)</span><kbd>Backspace</kbd></div>
                <div className="shortcut-item"><span>Delete task and its files</span><kbd>Delete</kbd></div>
              </div>
            </div>
            <div className="shortcut-group">
              <p className="shortcut-group-name">App</p>
              <div className="shortcut-list">
                <div className="shortcut-item"><span>Settings</span><kbd>{mod},</kbd></div>
                <div className="shortcut-item"><span>Close open panel / clear selection</span><kbd>Esc</kbd></div>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {overlay === 'about' && (
        <Modal title="About" onClose={() => setOverlay(null)}>
          <div className="about-content">
            <div className="about-name">ImageQueue</div>
            <p className="about-version">Version 0.1.0</p>
            <p className="about-desc">Multi-backend AI image generation queue.</p>
            <div className="about-links">
              <a
                href="https://github.com/nao7sep/imagequeue"
                target="_blank"
                rel="noreferrer"
                className="about-link"
              >
                GitHub ↗
              </a>
              <a
                href="https://github.com/nao7sep/imagequeue/issues"
                target="_blank"
                rel="noreferrer"
                className="about-link"
              >
                Report Issue ↗
              </a>
            </div>
            <p className="about-copyright">
              &copy; 2026 Yoshinao Inoguchi &mdash; MIT License
            </p>
          </div>
        </Modal>
      )}
      <div className="left-pane">
        <div className="pane-toolbar">
          <span className="app-name">ImageQueue</span>
          <div className="menu-anchor" ref={menuRef}>
            <button className="hamburger-btn" onClick={() => setShowMenu((v) => !v)}>☰</button>
            {showMenu && (
              <div className="dropdown-menu">
                <button onClick={() => { setShowMenu(false); void window.electronAPI.openOutputFolder() }}>Open Output Folder</button>
                <button onClick={() => openOverlay('settings')}>Settings</button>
                {window.electronAPI.platform === 'darwin' && (
                  <button onClick={() => {
                    setShowMenu(false)
                    window.dispatchEvent(new CustomEvent('open-models-modal'))
                  }}>
                    Draw Things Models
                  </button>
                )}
                <button onClick={() => openOverlay('shortcuts')}>Keyboard Shortcuts</button>
                <button onClick={() => openOverlay('about')}>About</button>
              </div>
            )}
          </div>
        </div>
        <PromptPane
            selectedTask={selectedTask}
            previewDataUrl={previewDataUrl}
            prompt={prompt}
            onPromptChange={setPrompt}
          />
      </div>
      <div className="right-pane">
        {BACKENDS.map((b) => (
          <QueueColumn
            key={b.id}
            backendId={b.id}
            label={b.label}
            hasPrompt={!!prompt.trim()}
          />
        ))}
      </div>
    </div>
  )
}
