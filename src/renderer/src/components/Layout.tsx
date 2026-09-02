import { useState, useEffect, useCallback, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { SettingsModal } from './SettingsModal'
import { SessionsModal } from './SessionsModal'
import { ElaboratorsModal } from './ElaboratorsModal'
import { ElaborationSettingsModal } from './ElaborationSettingsModal'
import { ElaboratedPromptsModal } from './ElaboratedPromptsModal'
import { ConceptLibraryModal } from './ConceptLibraryModal'
import { ShortcutsModal } from './ShortcutsModal'
import { AboutModal } from './AboutModal'
import { DependenciesModal } from './DependenciesModal'
import { Menu, MenuItem, MenuCheckboxItem, Submenu } from './Menu'
import { Icon } from './Icon'
import { QueueControlSubmenu, QueuePausedBadge } from './QueueControls'
import { AppStatusNotices } from './AppStatusNotices'
import { Modal } from './Modal'
import { isAnyModalOpen } from './modalStack'
import { BACKEND_LABELS } from '../../../shared/types'
import { WELCOME_PANE } from '../../../shared/layout-metrics'
import { WelcomePane } from './WelcomePane'
import { displayedColumnWidth } from '../../../shared/ui-state'
import { COLUMN_MAX_PX, COLUMN_MIN_PX } from '../../../shared/layout-metrics'
import './Layout.css'
import { useSelection } from '../context/SelectionContext'
import { useQueue } from '../context/QueueContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { useUiState } from '../context/UiStateContext'
import { useNotifications } from '../hooks/useNotifications'
import { useImeGuard } from '../utils/imeGuard'
import { useVisiblePanes } from '../hooks/useVisiblePanes'
import { hasMod, isEditableTarget, shadowsMacTextBinding } from '../utils/shortcuts'
import { reportOperationalFailure } from '../utils/operationalFailure'

type Overlay = 'settings' | 'sessions' | 'shortcuts' | 'about' | 'elaborators' | 'elaboration-settings' | 'elaborated-prompts' | 'concept-library' | 'dependencies' | null

export function Layout(): React.JSX.Element {
  useNotifications()
  const isImeComposing = useImeGuard()
  const { selectedTask, clear, navigate, removeSelected, restoreSelected, deleteSelected } = useSelection()
  const { showKeptImages, toggleShowKeptImages } = useQueue()
  // The right-hand group's panes, reactive to key presence and task counts.
  const { panes: PANES } = useVisiblePanes()
  // The main prompt lives in the session draft: persisted per session and
  // re-hydrated on session change (new/resume), alongside the Advanced
  // Prompting state. No local reset is needed — the context handles it.
  const { state: draft, update: updateDraft, draftUnavailable, retryDraftHydration } = useSessionDraft()
  const { uiState, patchUiState } = useUiState()
  const prompt = draft.prompt
  const setPrompt = useCallback((value: string): void => updateDraft({ prompt: value }), [updateDraft])
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)

  // Provider-column width. The persisted INTENT (px, or null = the default)
  // lives in state.json; the DISPLAYED width is derived from it and the live
  // window so a narrow reopen can't clip the columns, and returns to the intent
  // when the window grows. Only a splitter drag changes the intent and persists it.
  const visibleColumnCount = PANES.length
  const layoutRef = useRef<HTMLDivElement>(null)
  const [columnWidthIntent, setColumnWidthIntent] = useState<number | null>(null)
  const columnWidthIntentRef = useRef<number | null>(null)
  columnWidthIntentRef.current = columnWidthIntent
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const [draggingSplitter, setDraggingSplitter] = useState(false)

  // The width fed to the columns via the --iq-column-width CSS var. Until the
  // container is measured (first paint), the intent is shown as-is; the observer
  // corrects it immediately after. Below the summed minimum the window itself is
  // clamped (derived window minimum), so this never squeezes the left pane out.
  const displayedColumn = displayedColumnWidth(
    columnWidthIntent,
    containerWidth ?? Number.POSITIVE_INFINITY,
    visibleColumnCount,
  )

  // Adopt the persisted column width. It arrives through the one UI-state
  // context (hydrated once for the window), so this and the volume sliders share
  // a single reader and a single writer for state.json. A drag updates the local
  // intent live and only lands in the context on release, so this re-runs with a
  // value it already has.
  useEffect(() => {
    setColumnWidthIntent(uiState.columnWidth)
  }, [uiState.columnWidth])

  // Measure the layout width and keep it live, so a window resize re-derives the
  // displayed column width from the unchanged intent and persists nothing.
  useEffect(() => {
    const el = layoutRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setContainerWidth(rect.width)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setContainerWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Drag the splitter to set the provider-column width. The splitter sits at the
  // column group's left edge, so dragging left widens the group; that extra width
  // is shared across the visible columns (delta / count per column). The result is
  // clamped to [pane minimum, pane maximum] on every move; the display function
  // applies the tighter fit cap when needed. The final intent is
  // persisted on release — resize and mount never reach here, so they never write.
  const startSplitterDrag = useCallback((e: ReactMouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const count = visibleColumnCount
    const rect = layoutRef.current?.getBoundingClientRect()
    const container = rect?.width ?? containerWidth ?? Number.POSITIVE_INFINITY
    const startColumn = displayedColumnWidth(columnWidthIntentRef.current, container, count)
    let latest = startColumn
    setDraggingSplitter(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent): void => {
      const raw = startColumn - (ev.clientX - startX) / count
      // Store the INTENT, never a resize-induced fit clamp. Rendering re-derives
      // the displayed width from this preference on every frame.
      latest = Math.min(COLUMN_MAX_PX, Math.max(COLUMN_MIN_PX, Math.round(raw)))
      setColumnWidthIntent(latest)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDraggingSplitter(false)
      patchUiState({ columnWidth: latest })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [visibleColumnCount, containerWidth, patchUiState])

  // App/window chrome shortcuts. Cmd+, opens Settings, Cmd+/ opens the shortcut
  // reference, Cmd+Shift+K toggles kept images. Escape (when no Modal intercepts)
  // clears the selection — the hamburger Menu owns its own Escape and is not
  // handled here. Modals own their own Escape handling (see Modal.tsx) and stop
  // the event in the capture phase; the isAnyModalOpen guard keeps these
  // shortcuts from stacking a second modal or firing under an open one.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // While an IME candidate is pending, the keystroke belongs to the composition: Escape cancels
      // the candidate, and the mod-chords below must not fire on it either (text-input-and-IME).
      if (isImeComposing(e)) return

      if (e.key === 'Escape') {
        if (!overlay) clear()
        return
      }
      if (isAnyModalOpen()) return

      if (isEditableTarget(e.target) && shadowsMacTextBinding(e)) return

      const mod = hasMod(e)
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

  // The Draw Things pane pointer leads here by dispatching this event, so the
  // single management surface (this modal) opens from the pane as well as the menu.
  useEffect(() => {
    const handler = (): void => setOverlay('dependencies')
    window.addEventListener('open-dependencies-modal', handler)
    return () => window.removeEventListener('open-dependencies-modal', handler)
  }, [])

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
    }).catch((error) => {
      setPreviewDataUrl(null)
      reportOperationalFailure(`preview-${selectedTask.id}`, 'The selected image could not be loaded. Select it again to retry.', 'Failed to load selected image', error)
    })
  }, [selectedTask])

  // Open the fullscreen viewer window when Space is pressed on a completed task.
  // If the viewer is already open, Space toggles it closed.
  useEffect(() => {
    const handler = (): void => {
      if (viewerOpen) {
        void window.electronAPI.closeViewer().catch((error) => reportOperationalFailure('viewer', 'The image viewer could not be closed. Try again.', 'Failed to close image viewer', error))
      } else if (previewDataUrl) {
        void window.electronAPI.openViewer(previewDataUrl).catch((error) => reportOperationalFailure('viewer', 'The image viewer could not be opened. The selected image is unchanged; try again.', 'Failed to open image viewer', error))
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
    void window.electronAPI.openViewer(previewDataUrl).catch((error) => reportOperationalFailure('viewer', 'The image viewer could not be updated. Close it and try again.', 'Failed to update image viewer', error))
  }, [viewerOpen, previewDataUrl])

  // While the viewer is open, close it if navigation lands on a task without
  // a viewable image (queued/generating/failed, or selection cleared). The
  // main process refocuses the main window on close.
  useEffect(() => {
    if (!viewerOpen) return
    const status = selectedTask?.status
    const canShow = (status === 'completed' || status === 'kept') && !!selectedTask?.baseName
    if (!canShow) void window.electronAPI.closeViewer().catch((error) => reportOperationalFailure('viewer', 'The image viewer could not be closed. Try again.', 'Failed to close image viewer after selection change', error))
  }, [viewerOpen, selectedTask])

  return (
    <div
      className="layout"
      ref={layoutRef}
      style={{ '--iq-column-width': `${displayedColumn}px` } as React.CSSProperties}
    >
      {draftUnavailable && (
        <Modal
          title="Session draft needs to be reloaded"
          onClose={retryDraftHydration}
          dismissable={false}
          closeOnBackdropClick={false}
          footer={<button className="modal-btn" autoFocus onClick={retryDraftHydration}>Retry</button>}
        >
          <div className="modal-body"><p role="alert">{draftUnavailable}</p></div>
        </Modal>
      )}
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
      {overlay === 'concept-library' && (
        <ConceptLibraryModal onClose={() => setOverlay(null)} />
      )}
      {overlay === 'about' && (
        <AboutModal onClose={() => setOverlay(null)} />
      )}
      {overlay === 'dependencies' && (
        <DependenciesModal onClose={() => setOverlay(null)} />
      )}
      <div className="left-pane">
        <div className="pane-toolbar">
          <div className="pane-toolbar-title">
            <span className="app-name">ImageQueue</span>
            <QueuePausedBadge />
          </div>
          <div className="pane-toolbar-actions">
          <Menu
            label="Main menu"
            trigger={(props) => (
              <button className="hamburger-btn" aria-label="Main menu" {...props}>
                <Icon name="menu" />
              </button>
            )}
          >
            <MenuItem onSelect={() => { void window.electronAPI.openOutputFolder().catch((error) => reportOperationalFailure('output-folder', 'The output folder could not be opened. Check that it is still available.', 'Failed to open output folder', error)) }}>Open Output Folder</MenuItem>
            <MenuItem onSelect={() => setOverlay('sessions')}>Sessions</MenuItem>
            <QueueControlSubmenu />
            <MenuCheckboxItem checked={showKeptImages} onToggle={toggleShowKeptImages}>
              Show Kept Images
            </MenuCheckboxItem>
            <MenuItem onSelect={() => setOverlay('settings')}>Settings</MenuItem>
            {window.electronAPI.platform === 'darwin' && (
              <MenuItem onSelect={() => setOverlay('dependencies')}>
                Managed tools
              </MenuItem>
            )}
            {window.electronAPI.platform === 'darwin' && (
              <MenuItem onSelect={() => window.dispatchEvent(new CustomEvent('open-models-modal'))}>
                Draw Things Models
              </MenuItem>
            )}
            <Submenu label="Elaboration">
              <MenuItem onSelect={() => setOverlay('elaborators')}>Elaborators</MenuItem>
              <MenuItem onSelect={() => setOverlay('elaboration-settings')}>Settings</MenuItem>
              <MenuItem onSelect={() => setOverlay('elaborated-prompts')}>Prompts</MenuItem>
              <MenuItem onSelect={() => setOverlay('concept-library')}>Concept Library</MenuItem>
            </Submenu>
            <MenuItem onSelect={() => setOverlay('shortcuts')}>Keyboard Shortcuts</MenuItem>
            <MenuItem onSelect={() => setOverlay('about')}>About</MenuItem>
          </Menu>
          </div>
        </div>
        <AppStatusNotices />
        <PromptPane
            selectedTask={selectedTask}
            previewDataUrl={previewDataUrl}
            prompt={prompt}
            onPromptChange={setPrompt}
          />
      </div>
      <div
        className={`pane-splitter${draggingSplitter ? ' dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize provider columns"
        onMouseDown={startSplitterDrag}
      />
      <div className="right-pane">
        {PANES.map((pane) =>
          pane === WELCOME_PANE ? (
            <WelcomePane
              key={pane}
              onOpenSettings={() => setOverlay('settings')}
            />
          ) : (
            <QueueColumn
              key={pane}
              backendId={pane}
              label={BACKEND_LABELS[pane]}
              prompt={prompt}
            />
          )
        )}
      </div>
    </div>
  )
}
