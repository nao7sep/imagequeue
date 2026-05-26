import { useState, useEffect, useRef } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { Settings } from './Settings'
import { Modal } from './Modal'
import { SessionsModal } from './SessionsModal'
import { ElaboratorsModal } from './ElaboratorsModal'
import { ElaborationSettingsModal } from './ElaborationSettingsModal'
import { ElaboratedPromptsModal } from './ElaboratedPromptsModal'
import { BACKEND_IDS_IN_UI_ORDER, BACKEND_LABELS } from '../../../shared/types'
import './Layout.css'
import { useSelection } from '../context/SelectionContext'
import { useQueue } from '../context/QueueContext'
import { useNotifications } from '../hooks/useNotifications'

const ALL_BACKENDS = BACKEND_IDS_IN_UI_ORDER.map((id) => ({ id, label: BACKEND_LABELS[id] }))

// Draw Things CLI is macOS-only — show it only on macOS
const BACKENDS = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  ? ALL_BACKENDS
  : ALL_BACKENDS.filter((b) => b.id !== 'drawthings')

type Overlay = 'settings' | 'sessions' | 'shortcuts' | 'about' | 'elaborators' | 'elaboration-settings' | 'elaborated-prompts' | null

export function Layout(): React.JSX.Element {
  useNotifications()
  const { selectedTask, clear, navigate, removeSelected, restoreSelected, deleteSelected } = useSelection()
  const { showKeptImages, toggleShowKeptImages } = useQueue()
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [prompt, setPrompt] = useState('')

  // Reset the main prompt on session change so its lifecycle matches the
  // Advanced Prompting modal: per-session, not persisted to disk, wiped on
  // new session / resume. Without this the prompt textarea would carry over
  // across sessions, which surprises users moving between sessions.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionChanged(() => {
      setPrompt('')
    })
    return unsubscribe
  }, [])
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current)
    }
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
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        if (e.repeat) return
        if (overlay) return
        e.preventDefault()
        toggleShowKeptImages()
        setShowMenu(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [overlay, showMenu, clear, toggleShowKeptImages])

  // Load image data when a completed task is selected
  useEffect(() => {
    if (
      !selectedTask ||
      (selectedTask.status !== 'completed' && selectedTask.status !== 'kept') ||
      !selectedTask.baseName
    ) {
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
  // If the viewer is already open, Space toggles it closed.
  useEffect(() => {
    const handler = (): void => {
      if (viewerOpen) {
        void window.electronAPI.closeViewer()
      } else if (previewDataUrl) {
        void window.electronAPI.openViewer(previewDataUrl)
      }
    }
    window.addEventListener('viewer:toggle', handler)
    return () => window.removeEventListener('viewer:toggle', handler)
  }, [previewDataUrl, viewerOpen])

  // Track viewer open/closed state so we know when to push updates vs. open
  // fresh, and so Space can toggle.
  useEffect(() => {
    return window.electronAPI.onViewerStateChanged((open) => setViewerOpen(open))
  }, [])

  // Forward arrow keys pressed in the fullscreen viewer to the same nav
  // function the main window uses. Selection (and main-window scroll) updates
  // immediately; the next two effects push the image or close the viewer.
  useEffect(() => {
    return window.electronAPI.onViewerNavigate((dir) => navigate(dir))
  }, [navigate])

  useEffect(() => {
    return window.electronAPI.onViewerAction((action) => {
      if (action === 'delete') {
        void deleteSelected()
        return
      }
      if (selectedTask?.status === 'kept') {
        void restoreSelected()
      } else {
        void removeSelected()
      }
    })
  }, [deleteSelected, removeSelected, restoreSelected, selectedTask?.status])

  // While the viewer is open, push new image data whenever the selected task's
  // image finishes loading. The main viewer code awaits img.decode() before
  // showing, so swaps are flash-free.
  useEffect(() => {
    if (!viewerOpen || !previewDataUrl) return
    void window.electronAPI.openViewer(previewDataUrl)
  }, [viewerOpen, previewDataUrl])

  // While the viewer is open, close it if navigation lands on a task without
  // a viewable image (queued/generating/failed, or selection cleared). The
  // main process refocuses the main window on close.
  useEffect(() => {
    if (!viewerOpen) return
    const status = selectedTask?.status
    const canShow = (status === 'completed' || status === 'kept') && !!selectedTask?.baseName
    if (!canShow) void window.electronAPI.closeViewer()
  }, [viewerOpen, selectedTask])

  const openOverlay = (o: Overlay): void => {
    setShowMenu(false)
    setOverlay(o)
  }

  const toggleKeptImagesFromMenu = (): void => {
    toggleShowKeptImages()
    if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current)
    menuCloseTimerRef.current = setTimeout(() => {
      setShowMenu(false)
      menuCloseTimerRef.current = null
    }, 400)
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
                <div className="shortcut-item"><span>Replace prompt with clipboard text</span><kbd>{mod}P</kbd></div>
                <div className="shortcut-item"><span>Send to all backends</span><kbd>{mod}Enter</kbd></div>
                {BACKENDS.map((backend, index) => (
                  <div key={backend.id} className="shortcut-item">
                    <span>Send to {backend.label}</span>
                    <kbd>{mod}{index + 1}</kbd>
                  </div>
                ))}
              </div>
            </div>
            <div className="shortcut-group">
              <p className="shortcut-group-name">Queue Navigation</p>
              <div className="shortcut-list">
                <div className="shortcut-item"><span>Move up / down within column (also in fullscreen viewer)</span><kbd>Up / Down</kbd></div>
                <div className="shortcut-item"><span>Move to nearest task in adjacent column (also in fullscreen viewer)</span><kbd>Left / Right</kbd></div>
                <div className="shortcut-item"><span>Open fullscreen image viewer (Space or Esc to close)</span><kbd>Space</kbd></div>
                <div className="shortcut-item"><span>Remove task, keep selected completed image, or restore selected kept image</span><kbd>Backspace</kbd></div>
                <div className="shortcut-item"><span>Delete task and its files</span><kbd>Delete / {mod}Backspace</kbd></div>
              </div>
            </div>
            <div className="shortcut-group">
              <p className="shortcut-group-name">App</p>
              <div className="shortcut-list">
                <div className="shortcut-item"><span>Settings</span><kbd>{mod}Comma</kbd></div>
                <div className="shortcut-item"><span>Show / hide kept images</span><kbd>{mod}Shift+K</kbd></div>
                <div className="shortcut-item"><span>Close open panel / clear selection</span><kbd>Esc</kbd></div>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {overlay === 'sessions' && (
        <SessionsModal onClose={() => setOverlay(null)} />
      )}
      {overlay === 'elaborators' && (
        <ElaboratorsModal onClose={() => setOverlay(null)} />
      )}
      {overlay === 'elaboration-settings' && (
        <ElaborationSettingsModal onClose={() => setOverlay(null)} />
      )}
      {overlay === 'elaborated-prompts' && (
        <ElaboratedPromptsModal onClose={() => setOverlay(null)} />
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
                <button onClick={() => openOverlay('sessions')}>Sessions</button>
                <button className="menu-check-item" onClick={toggleKeptImagesFromMenu}>
                  <input type="checkbox" checked={showKeptImages} readOnly tabIndex={-1} />
                  <span>Show Kept Images</span>
                </button>
                <button onClick={() => openOverlay('settings')}>Settings</button>
                {window.electronAPI.platform === 'darwin' && (
                  <button onClick={() => {
                    setShowMenu(false)
                    window.dispatchEvent(new CustomEvent('open-models-modal'))
                  }}>
                    Draw Things Models
                  </button>
                )}
                <div className="menu-has-submenu">
                  <button className="menu-submenu-parent" type="button">
                    <span>Elaboration</span>
                    <span className="menu-submenu-arrow" aria-hidden="true">▸</span>
                  </button>
                  <div className="menu-submenu" role="menu">
                    <button onClick={() => openOverlay('elaborators')}>Elaborators</button>
                    <button onClick={() => openOverlay('elaboration-settings')}>Elaboration Settings</button>
                    <button onClick={() => openOverlay('elaborated-prompts')}>Elaborated Prompts</button>
                  </div>
                </div>
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
