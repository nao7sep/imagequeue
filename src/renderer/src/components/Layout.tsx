import { useState, useCallback, useEffect, useRef } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { Settings } from './Settings'
import type { Task } from '../../../shared/types'
import './Layout.css'
import { useQueue } from '../context/QueueContext'

const ALL_BACKENDS = [
  { id: 'openai' as const, label: 'GPT Image' },
  { id: 'imagen' as const, label: 'Google Imagen' },
  { id: 'nanobanana' as const, label: 'Nano Banana' },
  { id: 'grok' as const, label: 'Grok Imagine' },
  { id: 'flux' as const, label: 'FLUX' },
  { id: 'drawthings' as const, label: 'Draw Things' }
]

// On Windows, Draw Things CLI is not available — show only cloud backends
const BACKENDS = typeof window !== 'undefined' && window.electronAPI?.platform === 'win32'
  ? ALL_BACKENDS.filter((b) => b.id !== 'drawthings')
  : ALL_BACKENDS

type Overlay = 'settings' | 'shortcuts' | 'about' | null

export function Layout(): React.JSX.Element {
  const { tasks } = useQueue()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
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

  // Close any open overlay (or menu) with Escape; open Settings with ⌘,
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOverlay(null)
        setShowMenu(false)
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
  }, [])

  // Delete key removes the selected task (when not typing)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (!selectedTask) return
      if (selectedTask.status === 'generating') return
      window.electronAPI.removeTask(selectedTask.backend, selectedTask.id)
      setSelectedTask(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedTask])

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task)
  }, [])

  // Load image data when a completed task is selected
  useEffect(() => {
    if (!selectedTask || selectedTask.status !== 'completed' || !selectedTask.baseName) {
      setPreviewDataUrl(null)
      return
    }

    window.electronAPI.getImage(selectedTask.baseName).then((b64) => {
      if (b64) {
        const mime = b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png'
        setPreviewDataUrl(`data:${mime};base64,${b64}`)
      } else {
        setPreviewDataUrl(null)
      }
    })
  }, [selectedTask])

  useEffect(() => {
    if (!selectedTask) return
    const allTasks = Object.values(tasks).flat()
    if (!allTasks.some((t) => t.id === selectedTask.id)) {
      setSelectedTask(null)
      setPreviewDataUrl(null)
    }
  }, [tasks, selectedTask])

  const openOverlay = (o: Overlay): void => {
    setShowMenu(false)
    setOverlay(o)
  }

  return (
    <div className="layout">
      {overlay === 'settings' && (
        <div className="modal-backdrop" onClick={() => setOverlay(null)}>
          <div className="modal-box settings-modal-box" onClick={(e) => e.stopPropagation()}>
            <Settings onClose={() => setOverlay(null)} />
          </div>
        </div>
      )}
      {overlay === 'shortcuts' && (() => {
        const isWin = window.electronAPI.platform === 'win32'
        const mod = isWin ? 'Ctrl+' : 'Cmd+'
        const enter = 'Enter'
        const del = 'Backspace'
        return (
          <div className="modal-backdrop" onClick={() => setOverlay(null)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <span>Keyboard Shortcuts</span>
                <button className="modal-close" onClick={() => setOverlay(null)}>✕</button>
              </div>
              <div className="shortcuts-body">
                <div className="shortcut-group">
                  <p className="shortcut-group-name">Sending</p>
                  <div className="shortcut-list">
                    <div className="shortcut-item"><span>Send to all backends</span><kbd>{mod}{enter}</kbd></div>
                    <div className="shortcut-item"><span>Send to GPT Image</span><kbd>{mod}1</kbd></div>
                    <div className="shortcut-item"><span>Send to Google Imagen</span><kbd>{mod}2</kbd></div>
                    <div className="shortcut-item"><span>Send to Nano Banana</span><kbd>{mod}3</kbd></div>
                    <div className="shortcut-item"><span>Send to Grok Imagine</span><kbd>{mod}4</kbd></div>
                    <div className="shortcut-item"><span>Send to FLUX</span><kbd>{mod}5</kbd></div>
                    {!isWin && (
                      <div className="shortcut-item"><span>Send to Draw Things</span><kbd>{mod}6</kbd></div>
                    )}
                  </div>
                </div>
                <div className="shortcut-group">
                  <p className="shortcut-group-name">Queue</p>
                  <div className="shortcut-list">
                    <div className="shortcut-item"><span>Remove selected task</span><kbd>{del}</kbd></div>
                  </div>
                </div>
                <div className="shortcut-group">
                  <p className="shortcut-group-name">App</p>
                  <div className="shortcut-list">
                    <div className="shortcut-item"><span>Settings</span><kbd>{mod},</kbd></div>
                    <div className="shortcut-item"><span>Close open panel</span><kbd>Esc</kbd></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      {overlay === 'about' && (
        <div className="modal-backdrop" onClick={() => setOverlay(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>About</span>
              <button className="modal-close" onClick={() => setOverlay(null)}>✕</button>
            </div>
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
          </div>
        </div>
      )}
      <div className="left-pane">
        <div className="pane-toolbar">
          <span className="app-name">ImageQueue</span>
          <div className="menu-anchor" ref={menuRef}>
            <button className="hamburger-btn" onClick={() => setShowMenu((v) => !v)}>☰</button>
            {showMenu && (
              <div className="dropdown-menu">
                <button onClick={() => openOverlay('settings')}>Settings</button>
                {window.electronAPI.platform !== 'win32' && (
                  <button onClick={() => {
                    setShowMenu(false)
                    window.dispatchEvent(new CustomEvent('open-models-modal'))
                  }}>
                    Manage Draw Things Models
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
            onSelectTask={handleSelectTask}
          />
        ))}
      </div>
    </div>
  )
}
