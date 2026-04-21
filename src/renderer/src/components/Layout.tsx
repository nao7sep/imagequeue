import { useState, useCallback, useEffect, useRef } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { Settings } from './Settings'
import type { Task } from '../../../shared/types'
import './Layout.css'
import { useQueue } from '../context/QueueContext'
import { useSettings } from '../context/SettingsContext'

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
const MIN_COLUMN_WIDTH = 200
const RESIZE_HANDLE_WIDTH = 5

function clampLeftWidth(w: number, numBackends: number): number {
  const minRight = numBackends * MIN_COLUMN_WIDTH
  const maxAllowed = Math.max(MIN_LEFT_WIDTH, window.innerWidth - minRight - RESIZE_HANDLE_WIDTH)
  return Math.max(MIN_LEFT_WIDTH, Math.min(maxAllowed, w))
}

type Overlay = 'settings' | 'shortcuts' | 'about' | null

export function Layout(): React.JSX.Element {
  const { tasks } = useQueue()
  const { settings } = useSettings()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH)
  const isDragging = useRef(false)
  const latestWidth = useRef(DEFAULT_LEFT_WIDTH)
  const menuRef = useRef<HTMLDivElement>(null)
  const widthInitialized = useRef(false)

  // Initialize pane width from settings once they load (runs only on first non-null value)
  useEffect(() => {
    if (!settings || widthInitialized.current) return
    widthInitialized.current = true
    const ui = settings.ui as { leftPaneWidth?: number } | undefined
    const saved = ui?.leftPaneWidth ?? DEFAULT_LEFT_WIDTH
    setLeftWidth(clampLeftWidth(saved, BACKENDS.length))
    latestWidth.current = clampLeftWidth(saved, BACKENDS.length)
  }, [settings])

  // Shrink left pane if window becomes too small to show all columns
  useEffect(() => {
    const onResize = (): void => {
      setLeftWidth((w) => clampLeftWidth(w, BACKENDS.length))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
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
      const newWidth = clampLeftWidth(ev.clientX, BACKENDS.length)
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
      {overlay === 'shortcuts' && (
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
                  <div className="shortcut-item"><span>Send to all backends</span><kbd>⌘↵</kbd></div>
                  <div className="shortcut-item"><span>Send to GPT Image</span><kbd>⌘1</kbd></div>
                  <div className="shortcut-item"><span>Send to Imagen</span><kbd>⌘2</kbd></div>
                  <div className="shortcut-item"><span>Send to Nano Banana</span><kbd>⌘3</kbd></div>
                  <div className="shortcut-item"><span>Send to FLUX</span><kbd>⌘4</kbd></div>
                  <div className="shortcut-item"><span>Send to Draw Things</span><kbd>⌘5</kbd></div>
                </div>
              </div>
              <div className="shortcut-group">
                <p className="shortcut-group-name">Queue</p>
                <div className="shortcut-list">
                  <div className="shortcut-item"><span>Remove selected task</span><kbd>⌫</kbd></div>
                </div>
              </div>
              <div className="shortcut-group">
                <p className="shortcut-group-name">App</p>
                <div className="shortcut-list">
                  <div className="shortcut-item"><span>Settings</span><kbd>⌘,</kbd></div>
                  <div className="shortcut-item"><span>Close open panel</span><kbd>Esc</kbd></div>
                </div>
              </div>
            </div>
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
      <div className="left-pane" style={{ width: leftWidth }}>
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
      <div className="resize-handle" onMouseDown={handleMouseDown} />
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
