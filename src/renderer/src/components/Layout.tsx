import { useState, useEffect, useCallback } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { SettingsModal } from './SettingsModal'
import { SessionsModal } from './SessionsModal'
import { ElaboratorsModal } from './ElaboratorsModal'
import { ElaborationSettingsModal } from './ElaborationSettingsModal'
import { ElaboratedPromptsModal } from './ElaboratedPromptsModal'
import { ShortcutsModal } from './ShortcutsModal'
import { AboutModal } from './AboutModal'
import { Menu, MenuItem, MenuCheckboxItem, Submenu } from './Menu'
import { isAnyModalOpen } from './modalStack'
import { BACKEND_IDS_IN_UI_ORDER, BACKEND_LABELS } from '../../../shared/types'
import './Layout.css'
import { useSelection } from '../context/SelectionContext'
import { useQueue } from '../context/QueueContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { useNotifications } from '../hooks/useNotifications'
import { useImeGuard } from '../utils/imeGuard'

const ALL_BACKENDS = BACKEND_IDS_IN_UI_ORDER.map((id) => ({ id, label: BACKEND_LABELS[id] }))

// Draw Things CLI is macOS-only — show it only on macOS
const BACKENDS = window.electronAPI.platform === 'darwin'
  ? ALL_BACKENDS
  : ALL_BACKENDS.filter((b) => b.id !== 'drawthings')

type Overlay = 'settings' | 'sessions' | 'shortcuts' | 'about' | 'elaborators' | 'elaboration-settings' | 'elaborated-prompts' | null

export function Layout(): React.JSX.Element {
  useNotifications()
  const isImeComposing = useImeGuard()
  const { selectedTask, clear, navigate, removeSelected, restoreSelected, deleteSelected } = useSelection()
  const { showKeptImages, toggleShowKeptImages } = useQueue()
  // The main prompt lives in the session draft: persisted per session and
  // re-hydrated on session change (new/resume), alongside the Advanced
  // Prompting state. No local reset is needed — the context handles it.
  const { state: draft, update: updateDraft } = useSessionDraft()
  const prompt = draft.prompt
  const setPrompt = useCallback((value: string): void => updateDraft({ prompt: value }), [updateDraft])
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)

  // App/window chrome shortcuts. Cmd+, opens Settings, Cmd+/ opens the shortcut
  // reference, Cmd+Shift+K toggles kept images. Escape (when no Modal intercepts)
  // clears the selection — the hamburger Menu owns its own Escape and is not
  // handled here. Modals own their own Escape handling (see Modal.tsx) and stop
  // the event in the capture phase; the isAnyModalOpen guard keeps these
  // shortcuts from stacking a second modal or firing under an open one.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // During an IME composition, Escape cancels the composition and belongs
        // to the IME — it must not also clear the selection here.
        if (isImeComposing(e)) return
        if (!overlay) clear()
        return
      }
      if (isAnyModalOpen()) return

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === ',') {
        e.preventDefault()
        setOverlay('settings')
        return
      }
      if (mod && e.key === '/') {
        e.preventDefault()
        setOverlay('shortcuts')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'k') {
        if (e.repeat) return
        e.preventDefault()
        toggleShowKeptImages()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [overlay, clear, toggleShowKeptImages, isImeComposing])

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

  return (
    <div className="layout">
      {overlay === 'settings' && (
        <SettingsModal onClose={() => setOverlay(null)} />
      )}
      {overlay === 'shortcuts' && (
        <ShortcutsModal onClose={() => setOverlay(null)} />
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
        <AboutModal onClose={() => setOverlay(null)} />
      )}
      <div className="left-pane">
        <div className="pane-toolbar">
          <span className="app-name">ImageQueue</span>
          <Menu
            label="Main menu"
            trigger={(props) => (
              <button className="hamburger-btn" {...props}>☰</button>
            )}
          >
            <MenuItem onSelect={() => { void window.electronAPI.openOutputFolder() }}>Open Output Folder</MenuItem>
            <MenuItem onSelect={() => setOverlay('sessions')}>Sessions</MenuItem>
            <MenuCheckboxItem checked={showKeptImages} onToggle={toggleShowKeptImages}>
              Show Kept Images
            </MenuCheckboxItem>
            <MenuItem onSelect={() => setOverlay('settings')}>Settings</MenuItem>
            {window.electronAPI.platform === 'darwin' && (
              <MenuItem onSelect={() => window.dispatchEvent(new CustomEvent('open-models-modal'))}>
                Draw Things Models
              </MenuItem>
            )}
            <Submenu label="Elaboration">
              <MenuItem onSelect={() => setOverlay('elaborators')}>Elaborators</MenuItem>
              <MenuItem onSelect={() => setOverlay('elaboration-settings')}>Elaboration Settings</MenuItem>
              <MenuItem onSelect={() => setOverlay('elaborated-prompts')}>Elaborated Prompts</MenuItem>
            </Submenu>
            <MenuItem onSelect={() => setOverlay('shortcuts')}>Keyboard Shortcuts</MenuItem>
            <MenuItem onSelect={() => setOverlay('about')}>About</MenuItem>
          </Menu>
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
            prompt={prompt}
          />
        ))}
      </div>
    </div>
  )
}
