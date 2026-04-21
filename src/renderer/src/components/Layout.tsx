import { useState, useCallback, useEffect, useRef } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { Settings } from './Settings'
import type { Task } from '../../../shared/types'
import './Layout.css'

const ALL_BACKENDS = [
  { id: 'openai' as const, label: 'GPT Image' },
  { id: 'imagen' as const, label: 'Imagen' },
  { id: 'nanobanana' as const, label: 'Nano Banana' },
  { id: 'flux' as const, label: 'FLUX' },
  { id: 'drawthings' as const, label: 'Draw Things' }
]

// On Windows, Draw Things CLI is not available — show only cloud backends
const BACKENDS = typeof window !== 'undefined' && window.electronAPI?.platform === 'win32'
  ? ALL_BACKENDS.filter((b) => b.id !== 'drawthings')
  : ALL_BACKENDS

const DEFAULT_LEFT_WIDTH = 360
const MIN_LEFT_WIDTH = 280
const MAX_LEFT_WIDTH = 800

type Overlay = 'settings' | 'shortcuts' | 'about' | null

export function Layout(): React.JSX.Element {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH)
  const isDragging = useRef(false)
  const latestWidth = useRef(DEFAULT_LEFT_WIDTH)
  const menuRef = useRef<HTMLDivElement>(null)

  // Load persisted width from config on mount
  useEffect(() => {
    window.electronAPI.getSettings().then((config) => {
      const ui = config.ui as { leftPaneWidth?: number } | undefined
      if (ui?.leftPaneWidth) {
        setLeftWidth(Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, ui.leftPaneWidth)))
      }
    })
  }, [])

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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent): void => {
      if (!isDragging.current) return
      const newWidth = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, ev.clientX))
      setLeftWidth(newWidth)
      latestWidth.current = newWidth
    }

    const onMouseUp = (): void => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // Persist to config
      window.electronAPI.saveUi({ leftPaneWidth: latestWidth.current })
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

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
        setPreviewDataUrl(`data:image/png;base64,${b64}`)
      } else {
        setPreviewDataUrl(null)
      }
    })
  }, [selectedTask])

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
      {overlay === 'shortcuts' && (
        <div className="modal-backdrop" onClick={() => setOverlay(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>Keyboard Shortcuts</span>
              <button className="modal-close" onClick={() => setOverlay(null)}>✕</button>
            </div>
            <table className="shortcuts-table">
              <tbody>
                <tr className="shortcuts-group"><td colSpan={2}>Sending</td></tr>
                <tr><td>⌘↵ / Ctrl+↵</td><td>Send prompt to all backends</td></tr>
                <tr><td>⌘1 / Ctrl+1</td><td>Send to GPT Image</td></tr>
                <tr><td>⌘2 / Ctrl+2</td><td>Send to Imagen</td></tr>
                <tr><td>⌘3 / Ctrl+3</td><td>Send to FLUX</td></tr>
                <tr><td>⌘4 / Ctrl+4</td><td>Send to Draw Things</td></tr>
                <tr className="shortcuts-group"><td colSpan={2}>History</td></tr>
                <tr><td>⌘↑ / Ctrl+↑</td><td>Older prompt</td></tr>
                <tr><td>⌘↓ / Ctrl+↓</td><td>Newer prompt</td></tr>
                <tr className="shortcuts-group"><td colSpan={2}>Queue</td></tr>
                <tr><td>⌫</td><td>Remove selected task</td></tr>
                <tr className="shortcuts-group"><td colSpan={2}>App</td></tr>
                <tr><td>⌘, / Ctrl+,</td><td>Settings</td></tr>
                <tr><td>Esc</td><td>Close any open panel</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      {overlay === 'about' && (
        <div className="modal-backdrop" onClick={() => setOverlay(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>About</span>
              <button className="modal-close" onClick={() => setOverlay(null)}>✕</button>
            </div>
            <div className="about-content">
              <div className="about-name">ImageQueue</div>
              <div className="about-version">Version 0.1.0</div>
              <div className="about-desc">Multi-backend AI image generation queue</div>
            </div>
          </div>
        </div>
      )}
      <div className="left-pane" style={{ width: leftWidth }}>
        <div className="pane-toolbar">
          <span className="app-name">ImageQueue</span>
          <div className="menu-anchor" ref={menuRef}>
            <button className="hamburger-btn" onClick={() => setShowMenu((v) => !v)}>☰</button>
            {showMenu && (
              <div className="dropdown-menu">
                <button onClick={() => openOverlay('settings')}>Settings</button>
                <button onClick={() => openOverlay('shortcuts')}>Keyboard Shortcuts</button>
                <button onClick={() => openOverlay('about')}>About</button>
              </div>
            )}
          </div>
        </div>
        <PromptPane selectedTask={selectedTask} previewDataUrl={previewDataUrl} />
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="right-pane">
        {BACKENDS.map((b) => (
          <QueueColumn
            key={b.id}
            backendId={b.id}
            label={b.label}
            onSelectTask={handleSelectTask}
          />
        ))}
      </div>
    </div>
  )
}
