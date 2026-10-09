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
import { Modal } from './Modal'
import { isAnyModalOpen } from './modalStack'
import { BACKEND_LABELS } from '../../../shared/types'
import { WELCOME_PANE } from '../../../shared/layout-metrics'
import { WelcomePane } from './WelcomePane'
import { displayedColumnWidth } from '../../../shared/ui-state'
import { COLUMN_MAX_PX, COLUMN_MIN_PX, computeWindowMinWidth, computeWindowMinHeight } from '../../../shared/layout-metrics'
import './Layout.css'
import { useSelection } from '../context/SelectionContext'
import { useQueue } from '../context/QueueContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { useUiState } from '../context/UiStateContext'
import { useNotifications } from '../hooks/useNotifications'
import { useImeGuard } from '../utils/imeGuard'
import { useVisiblePanes } from '../hooks/useVisiblePanes'
import { hasMod, isEditableTarget, shadowsMacTextBinding } from '../utils/shortcuts'
import { clearOperationalFailure, recordOperationalDiagnostic, reportOperationalFailure } from '../utils/operationalFailure'
import { canShowImage, selectedImageOf } from '../../../shared/viewing'
import { FULLSCREEN_VIEW_TOGGLE_EVENT } from '../utils/fullscreenView'
import { useI18n } from '../i18n/I18nContext'

type Overlay = 'settings' | 'sessions' | 'shortcuts' | 'about' | 'elaborators' | 'elaboration-settings' | 'elaborated-prompts' | 'concept-library' | 'dependencies' | null

export function Layout(): React.JSX.Element {
  const { t } = useI18n()
  useNotifications()
  const isImeComposing = useImeGuard()
  const {
    selectedTask,
    clear,
    navigate,
    removeSelected,
    restoreSelected,
    deleteSelected,
  } = useSelection()
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

  // The selection, as the preview window and the fullscreen view follow it. A
  // new snapshot goes out only when what they show changes, not on every queue
  // update that hands the same task back as a new object.
  const selectedImage = selectedImageOf(selectedTask)
  const selectedImageKey = JSON.stringify(selectedImage)
  const selectedImageRef = useRef(selectedImage)
  selectedImageRef.current = selectedImage
  useEffect(() => {
    void window.electronAPI.publishSelection(selectedImageRef.current)
      .catch((error) => recordOperationalDiagnostic('Failed to publish the selection to the other views', error))
  }, [selectedImageKey])

  const [fullscreenViewOpen, setFullscreenViewOpen] = useState(false)
  useEffect(() => {
    return window.electronAPI.onFullscreenViewStateChanged(setFullscreenViewOpen)
  }, [])

  // Space or a double-click on a task with an image opens the fullscreen view.
  // The view takes the keyboard while open and closes itself on Space, so the
  // close here is only for a toggle that arrives while it is still open.
  const toggleFullscreenView = useCallback((): void => {
    if (fullscreenViewOpen) {
      void window.electronAPI.closeFullscreenView()
        .catch((error) => reportOperationalFailure('fullscreen-view-close', 'operation.fullscreenViewCloseFailed', 'Failed to close the fullscreen view', error))
    } else if (canShowImage(selectedImageRef.current)) {
      void window.electronAPI.openFullscreenView()
        .then(() => clearOperationalFailure('fullscreen-view-open'))
        .catch((error) => reportOperationalFailure('fullscreen-view-open', 'operation.fullscreenViewOpenFailed', 'Failed to open the fullscreen view', error))
    }
  }, [fullscreenViewOpen])

  useEffect(() => {
    window.addEventListener(FULLSCREEN_VIEW_TOGGLE_EVENT, toggleFullscreenView)
    return () => window.removeEventListener(FULLSCREEN_VIEW_TOGGLE_EVENT, toggleFullscreenView)
  }, [toggleFullscreenView])

  // Keys pressed in the preview window or the fullscreen view act on the lists
  // as they do here. Arrows move the selection and scroll without taking focus
  // (navigate), and a confirmation shows in the view the key came from.
  useEffect(() => {
    return window.electronAPI.onListKey(({ key, surface }) => {
      switch (key) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          navigate(key)
          return
        case 'remove':
          if (selectedImageRef.current?.status === 'kept') void restoreSelected()
          else void removeSelected(surface)
          return
        case 'delete':
          void deleteSelected(surface)
      }
    })
  }, [navigate, removeSelected, restoreSelected, deleteSelected])

  return (
    <div className="layout-viewport">
    <div
      className="layout"
      ref={layoutRef}
      style={{ '--iq-column-width': `${displayedColumn}px`, minWidth: computeWindowMinWidth(visibleColumnCount), minHeight: computeWindowMinHeight() } as React.CSSProperties}
    >
      {draftUnavailable && (
        <Modal
          title={t('draft.reloadTitle')}
          onClose={retryDraftHydration}
          dismissable={false}
          closeOnBackdropClick={false}
          footer={<button className="modal-btn" autoFocus onClick={retryDraftHydration}>{t('common.retry')}</button>}
        >
          <div className="modal-body"><p role="alert">{t(draftUnavailable)}</p></div>
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
            label={t('menu.main')}
            trigger={(props) => (
              <button className="hamburger-btn" aria-label={t('menu.main')} {...props}>
                <Icon name="menu" />
              </button>
            )}
          >
            <MenuItem onSelect={() => { void window.electronAPI.openSessionsFolder().catch((error) => reportOperationalFailure('sessions-folder', 'operation.sessionsFolderFailed', 'Failed to open sessions folder', error)) }}>{t('menu.openSessionsFolder')}</MenuItem>
            <MenuItem onSelect={() => setOverlay('sessions')}>{t('menu.sessions')}</MenuItem>
            <QueueControlSubmenu />
            <MenuCheckboxItem checked={showKeptImages} onToggle={toggleShowKeptImages}>
              {t('menu.showKeptImages')}
            </MenuCheckboxItem>
            <MenuItem onSelect={() => setOverlay('settings')}>{t('menu.settings')}</MenuItem>
            {window.electronAPI.platform === 'darwin' && (
              <MenuItem onSelect={() => setOverlay('dependencies')}>
                {t('menu.managedTools')}
              </MenuItem>
            )}
            {window.electronAPI.platform === 'darwin' && (
              <MenuItem onSelect={() => window.dispatchEvent(new CustomEvent('open-models-modal'))}>
                {t('menu.drawThingsModels')}
              </MenuItem>
            )}
            <Submenu label={t('menu.elaboration')}>
              <MenuItem onSelect={() => setOverlay('elaborators')}>{t('menu.elaborators')}</MenuItem>
              <MenuItem onSelect={() => setOverlay('elaboration-settings')}>{t('menu.elaborationSettings')}</MenuItem>
              <MenuItem onSelect={() => setOverlay('elaborated-prompts')}>{t('menu.elaborationPrompts')}</MenuItem>
              <MenuItem onSelect={() => setOverlay('concept-library')}>{t('menu.conceptLibrary')}</MenuItem>
            </Submenu>
            <MenuItem onSelect={() => {
              void window.electronAPI.openRecordsWindow()
                .then(() => clearOperationalFailure('records-open'))
                .catch((error) => reportOperationalFailure('records-open', 'operation.recordsOpenFailed', 'Failed to open the Records window', error))
            }}>{t('menu.records')}</MenuItem>
            <MenuItem onSelect={() => setOverlay('shortcuts')}>{t('menu.keyboardShortcuts')}</MenuItem>
            <MenuItem onSelect={() => setOverlay('about')}>{t('menu.about')}</MenuItem>
          </Menu>
          </div>
        </div>
        <PromptPane
            selectedTask={selectedTask}
            prompt={prompt}
            onPromptChange={setPrompt}
          />
      </div>
      <div
        className={`pane-splitter${draggingSplitter ? ' dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('layout.resizeColumns')}
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
    </div>
  )
}
