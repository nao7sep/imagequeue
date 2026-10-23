import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useQueue } from '../context/QueueContext'
import { useSelection } from '../context/SelectionContext'
import { useSettings } from '../context/SettingsContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import type { BackendId, CloudBackendId, Task } from '../../../shared/types'
import { findModel, getDefaultModelForBackend, getModelsForBackend } from '../../../shared/ai-models'
import { currentSessionImageUrl, thumbnailUrl } from '../../../shared/image-url'
import { CLOUD_BACKENDS } from '../backends'
import { useDrawThingsColumn, DrawThingsControls } from './DrawThingsColumn'
import { DrawThingsModelsModal } from './DrawThingsModelsModal'
import { truncate, PROMPT_PREVIEW_MIN_GRAPHEMES } from '../../../shared/textCleanup'
import { canShowImage } from '../../../shared/viewing'
import { FULLSCREEN_VIEW_TOGGLE_EVENT } from '../utils/fullscreenView'
import { useAutosavedImageBackendDefaults } from '../hooks/useAutosavedImageBackendDefaults'
import {
  resolveSavedImageBackendDefaults,
  type SavedImageBackendDefaults,
} from '../utils/imageBackendDefaults'
import { hasApiKeyFor, isBackendReadyToEnqueue } from '../utils/enqueue'
import { isFreshCompletion, TASK_REVEAL_EVENT, type TaskRevealRequest } from '../utils/taskScroll'
import { taskFailureText, taskStatusLabel } from '../utils/taskPresentation'
import { useImeGuard } from '../utils/imeGuard'
import { Icon } from './Icon'
import { MenuItem } from './Menu'
import { SelectedActions, openSelectedActions } from './SelectedActions'
import { useI18n } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import './QueueColumn.css'

interface Props {
  backendId: BackendId
  label: string
  prompt: string
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--text-muted)',
  generating: 'var(--warning)',
  completed: 'var(--success)',
  kept: 'var(--text-secondary)',
  failed: 'var(--error)',
  interrupted: 'var(--text-secondary)',
}

export function QueueColumn({ backendId, label, prompt }: Props): React.JSX.Element {
  const hasPrompt = prompt.trim().length > 0
  const { t } = useI18n()
  const { tasks, loadState } = useQueue()
  const {
    selection,
    select,
    clear,
    navigate,
    selectEdge,
    removeSelected,
    restoreSelected,
    deleteSelected,
    runTaskAction,
  } = useSelection()
  const actionsRef = useRef<HTMLButtonElement>(null)
  const isComposing = useImeGuard()
  const { settings, apiKeyPresence, saveImageBackendDefaults } = useSettings()
  const { setSnapshot, enqueueToBackend } = useEnqueueConfigs()
  const models = getModelsForBackend(backendId)
  const defaultModel = getDefaultModelForBackend(backendId)
  const [model, setModel] = useState(defaultModel?.id ?? '')
  const proprietaryBackend = backendId === 'drawthings' ? null : backendId as CloudBackendId

  // The cloud backends share one generic parameter path: the descriptor owns
  // this backend's param model (defaults, clamping, enqueue payload, controls)
  // and the column holds a single params object. Draw Things is the one
  // non-descriptor backend — a local CLI with per-model persisted params — and
  // keeps its own state below.
  const cloudBackend = proprietaryBackend ? CLOUD_BACKENDS[proprietaryBackend] : null
  const cloudModelDef = useMemo(
    () => (proprietaryBackend ? findModel(proprietaryBackend, model) ?? null : null),
    [proprietaryBackend, model]
  )
  // A saved model that is not a row stays selected, shown as not in the list
  // with a warning, and queues its tasks with the plain request.
  const modelNotInList = proprietaryBackend !== null && model !== '' && cloudModelDef === null
  const [cloudParams, setCloudParams] = useState<Record<string, unknown>>(
    () => cloudBackend?.defaults() ?? {}
  )

  // The user's model choice re-validates the params: a value the new model does
  // not offer falls to that model's own default (descriptor semantics). Saved
  // defaults arrive already resolved for their model, so only this choice clamps.
  const chooseModel = (id: string): void => {
    setModel(id)
    const next = proprietaryBackend ? findModel(proprietaryBackend, id) : undefined
    if (cloudBackend && next) setCloudParams((prev) => cloudBackend.clampToModel(prev, next))
  }

  // Derived from context — updates automatically when settings change (no effect
  // needed). Read from the PRESENCE signal, never from settings' api_key string:
  // that string is the stored value only, so an env-supplied key would read as
  // missing here and disable a backend the main process can call perfectly well.
  const apiKeyMissing = !hasApiKeyFor(backendId, apiKeyPresence)

  // All Draw Things state, effects, and handlers live in useDrawThingsColumn;
  // the column consumes its enqueue params, readiness inputs, and controls.
  const drawThings = useDrawThingsColumn({
    active: backendId === 'drawthings',
    model,
    setModel,
    settings,
  })

  const columnTasks = tasks[backendId]
  const settingsLoaded = settings !== null
  const backendSettings = useMemo(
    () => (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.[backendId] ?? null,
    [settings, backendId]
  )
  const savedProprietaryDefaults = useMemo(
    () => proprietaryBackend
      ? resolveSavedImageBackendDefaults(proprietaryBackend, backendSettings, models, defaultModel)
      : null,
    [proprietaryBackend, backendSettings, models, defaultModel]
  )
  const currentEnqueueParams = useMemo<Record<string, unknown>>(() => {
    if (backendId === 'drawthings') {
      return drawThings.enqueueParams
    }
    if (cloudBackend && cloudModelDef) {
      return cloudBackend.toEnqueueParams(cloudParams, cloudModelDef)
    }
    return {}
  }, [backendId, drawThings.enqueueParams, cloudBackend, cloudModelDef, cloudParams])

  // Saved defaults land as the UI-shaped params the descriptor resolved; the
  // enqueue-shaped snapshot the autosave compares derives from the same
  // toEnqueueParams, so the two can never disagree.
  const applySavedProprietaryDefaults = useCallback((saved: SavedImageBackendDefaults): void => {
    setModel(saved.model)
    setCloudParams(saved.ui)
  }, [])

  const cloudDefaultsPersistence = useAutosavedImageBackendDefaults({
    backend: proprietaryBackend,
    settingsLoaded,
    saved: savedProprietaryDefaults,
    // Nothing is saved while the model is not in the list, so its saved record stands.
    currentModel: modelNotInList ? '' : model,
    currentParams: currentEnqueueParams,
    applySaved: applySavedProprietaryDefaults,
    saveDefaults: saveImageBackendDefaults,
  })

  // Backend-config readiness only (no prompt check — the prompt is validated by
  // the enqueue action). Mirrored into the snapshot so Send-to-All / Cmd+N can
  // skip not-ready backends, and reused for the "+ Queue" button's disabled state.
  const readyToEnqueue = (backendId !== 'drawthings' || drawThings.paramsReady) && isBackendReadyToEnqueue({
    backendId,
    apiKeyMissing,
    cliInstalled: drawThings.cliInstalled,
    downloadedModelCount: drawThings.downloadedModelCount,
  })

  useEffect(() => {
    if (!model) {
      setSnapshot(backendId, null)
      return
    }
    setSnapshot(backendId, { model, params: currentEnqueueParams, ready: readyToEnqueue })
  }, [backendId, model, currentEnqueueParams, readyToEnqueue, setSnapshot])

  useEffect(() => {
    return () => { setSnapshot(backendId, null) }
  }, [backendId, setSnapshot])

  // This column is a semantic list of roving selectable buttons. While one of
  // those buttons has focus, the list owns all four arrows, PageUp/PageDown,
  // Home/End, and the scoped command keys for the selected task. Navigation
  // (Up/Down within,
  // Left/Right to the adjacent column) is delegated to SelectionContext, which
  // keeps the single source of truth and follows focus to the moved-to row.
  // Backspace/Delete/Space form the command layer, scoped here so they act only
  // while focus is inside the queue — they read the selection from the context,
  // never from the DOM.
  const handleListKeyDown = useCallback((e: React.KeyboardEvent): void => {
    // A retained result is a sibling of its selectable button, not part of the
    // row command layer. Its focusable X owns Enter/Space and ordinary text
    // keys must never become remove/delete/navigation commands for the row.
    if (e.target instanceof HTMLElement && e.target.closest('.task-action-results')) return
    if (!isComposing(e.nativeEvent) && openSelectedActions(e, actionsRef)) return
    const sel = selection
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!sel) return
      e.preventDefault()
      navigate(
        e.key === 'ArrowUp' ? 'up' :
        e.key === 'ArrowDown' ? 'down' :
        e.key === 'ArrowLeft' ? 'left' : 'right'
      )
      return
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      if (!sel) return
      e.preventDefault()
      const list = e.currentTarget as HTMLElement
      const firstRow = list.querySelector<HTMLElement>('[data-task-id]')
      const pageStep = firstRow?.offsetHeight
        ? Math.max(1, Math.floor(list.clientHeight / firstRow.offsetHeight))
        : 8
      navigate(e.key === 'PageUp' ? 'up' : 'down', pageStep)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      selectEdge(backendId, 'first')
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      selectEdge(backendId, 'last')
      return
    }
    if (!sel) return

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Backspace') {
      if (e.repeat) return
      e.preventDefault()
      void deleteSelected()
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Backspace') {
      if (e.repeat) return
      e.preventDefault()
      const task = tasks[sel.backend]?.find((t) => t.id === sel.taskId)
      if (task?.status === 'kept') void restoreSelected()
      else void removeSelected()
      return
    }
    if (e.key === 'Delete') {
      if (e.repeat) return
      e.preventDefault()
      void deleteSelected()
      return
    }
    if (e.key === ' ') {
      if (isComposing(e.nativeEvent)) return
      const task = tasks[sel.backend]?.find((t) => t.id === sel.taskId)
      if (!canShowImage(task)) return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent(FULLSCREEN_VIEW_TOGGLE_EVENT))
    }
  }, [selection, navigate, selectEdge, backendId, tasks, deleteSelected, restoreSelected, removeSelected, isComposing])

  // The single roving tab stop for this column: the selected row when the
  // selection lives here, otherwise the first row. Exactly one option per column
  // is tabbable, so Tab enters the column at the active row and Tab leaves it.
  const tabbableTaskId = selection?.backend === backendId && columnTasks.some((t) => t.id === selection.taskId)
    ? selection.taskId
    : columnTasks[0]?.id ?? null

  const listRef = useRef<HTMLDivElement>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [pendingCompletionId, setPendingCompletionId] = useState<string | null>(null)
  const previousStatuses = useRef(new Map<string, Task['status']>())
  // Observe the full collection: a row may finish while virtualization has it
  // unmounted. Existing completed/kept rows never start a reveal on restoration.
  useLayoutEffect(() => {
    let completedId: string | null = null
    const next = new Map<string, Task['status']>()
    for (const task of columnTasks) {
      const previous = previousStatuses.current.get(task.id)
      if (previous !== undefined && isFreshCompletion(previous, task.status)) {
        completedId = task.id
      }
      next.set(task.id, task.status)
    }
    previousStatuses.current = next
    setPendingCompletionId((pending) => completedId ?? (pending && next.get(pending) === 'completed' ? pending : null))
  }, [columnTasks])

  const taskIndices = useMemo(() => new Map(columnTasks.map((task, index) => [task.id, index])), [columnTasks])
  const getTaskKey = useCallback((index: number) => columnTasks[index].id, [columnTasks])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: columnTasks.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 96,
    paddingStart: 8,
    paddingEnd: 8,
    getItemKey: getTaskKey,
    // Completion reveal runs in the image load handler, before ResizeObserver
    // necessarily delivers its new height; read that final height synchronously.
    measureElement: (element) => element.offsetHeight,
    rangeExtractor: (range) => {
      const indices = new Set(defaultRangeExtractor(range))
      // Roving focus and the context's next-frame focus handoff need the row
      // mounted even outside the viewport. Result controls retain focus too.
      for (const id of [tabbableTaskId, focusedTaskId, pendingCompletionId]) {
        const index = id === null ? undefined : taskIndices.get(id)
        if (index !== undefined) indices.add(index)
      }
      return [...indices].sort((a, b) => a - b)
    },
  })
  useEffect(() => {
    const reveal = (event: Event): void => {
      const request = (event as CustomEvent<TaskRevealRequest>).detail
      if (request.backend !== backendId) return
      const index = taskIndices.get(request.taskId)
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'auto' })
    }
    window.addEventListener(TASK_REVEAL_EVENT, reveal)
    return () => window.removeEventListener(TASK_REVEAL_EVENT, reveal)
  }, [backendId, taskIndices, virtualizer])
  const finishCompletion = useCallback((taskId: string, reveal: boolean): void => {
    if (taskId !== pendingCompletionId) return
    if (reveal) {
      const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-task-id="${CSS.escape(taskId)}"]`)
      const row = button?.closest<HTMLDivElement>('.task-virtual-row')
      if (row) virtualizer.measureElement(row)
      const index = taskIndices.get(taskId)
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'auto', behavior: 'smooth' })
    }
    setPendingCompletionId(null)
  }, [pendingCompletionId, taskIndices, virtualizer])

  const actionTask = selection?.backend === backendId
    ? columnTasks.find((task) => task.id === selection.taskId) ?? null
    : null

  return (
    <>
    <div className="queue-column" data-backend={backendId}>
      <div className="column-header">{label}</div>

      <div className="column-settings">
        {backendId !== 'drawthings' && (
          <div className="setting-row">
            <label>{t('column.model')}</label>
            <select value={model} onChange={(e) => chooseModel(e.target.value)}>
              {modelNotInList && (
                <option value={model}>{t('column.modelNotInListOption', { model })}</option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {modelNotInList && (
          <div className="setting-row model-warning">{t('column.modelNotInList')}</div>
        )}

        {/* The cloud backends' parameter rows come from this backend's
            descriptor — one generic element instead of a fork per backend. */}
        {cloudBackend && cloudModelDef && (
          <cloudBackend.Controls params={cloudParams} modelDef={cloudModelDef} onChange={setCloudParams} />
        )}

        {cloudDefaultsPersistence.saveFailure && (
          <div className="column-save-result" role="alert">
            <span>{t(cloudDefaultsPersistence.saveFailure)}</span>
            <button
              type="button"
              className="column-save-result-close"
              aria-label={t('column.closeSaveResult')}
              title={t('common.close')}
              onClick={cloudDefaultsPersistence.dismissSaveFailure}
            >
              <Icon name="close" />
            </button>
          </div>
        )}

        {backendId === 'drawthings' && (
          <DrawThingsControls model={model} column={drawThings} />
        )}

        {apiKeyMissing && (
          <div className="setting-row model-warning">{t('column.apiKeyNotSet')}</div>
        )}

        <button
          className="enqueue-btn"
          disabled={!hasPrompt || !readyToEnqueue}
          onClick={() => enqueueToBackend(backendId, prompt)}
        >
          <Icon name="plus" /> {t('column.queue')}
        </button>
      </div>

      <SelectedActions triggerRef={actionsRef} disabled={!actionTask}>
        <MenuItem disabled={!actionTask || (actionTask.status !== 'failed' && actionTask.status !== 'interrupted')}
          onSelect={() => { if (actionTask && (actionTask.status === 'failed' || actionTask.status === 'interrupted')) retryQueueTask(backendId, actionTask.id, runTaskAction) }}>
          {t('task.retry')}
        </MenuItem>
        {actionTask?.status === 'kept' ? (
          <MenuItem onSelect={() => void restoreSelected()}>{t('task.restore')}</MenuItem>
        ) : (
          <MenuItem disabled={!actionTask || actionTask.status === 'generating'} onSelect={() => void removeSelected()}>
            {t(actionTask?.status === 'completed' ? 'task.keep' : 'task.remove')}
          </MenuItem>
        )}
        <MenuItem disabled={!actionTask || (actionTask.status !== 'completed' && actionTask.status !== 'kept')}
          onSelect={() => void deleteSelected()}>{t('task.delete')}</MenuItem>
      </SelectedActions>

      <div
        ref={listRef}
        className="task-list"
        role="list"
        aria-label={t('column.queueLabel', { backend: label })}
        onKeyDown={handleListKeyDown}
        onFocusCapture={(event) => {
          const entry = (event.target as HTMLElement).closest<HTMLElement>('[data-task-row-id]')
          setFocusedTaskId(entry?.dataset.taskRowId ?? null)
        }}
        onBlurCapture={(event) => {
          const entry = event.relatedTarget instanceof HTMLElement
            ? event.relatedTarget.closest<HTMLElement>('[data-task-row-id]')
            : null
          setFocusedTaskId(entry?.dataset.taskRowId ?? null)
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target instanceof HTMLElement &&
            (e.target.classList.contains('task-virtual-space') || e.target.classList.contains('task-virtual-row')))) clear()
        }}
      >
        {columnTasks.length === 0 ? (
          <div
            className={`task-list-empty${loadState === 'failed' ? ' task-list-empty-error' : ''}`}
            role="presentation"
          >
            {loadState === 'loading'
              ? t('column.loadingQueue')
              : loadState === 'failed'
                ? t('column.loadFailed')
                : t('column.noTasks')}
          </div>
        ) : (
          <div className="task-virtual-space" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const task = columnTasks[row.index]
              return (
                <div
                  key={row.key}
                  className="task-virtual-row"
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <TaskItem
                    task={task}
                    position={row.index + 1}
                    total={columnTasks.length}
                    pendingCompletion={task.id === pendingCompletionId}
                    finishCompletion={finishCompletion}
                    backendId={backendId}
                    isSelected={selection?.backend === backendId && selection.taskId === task.id}
                    isTabbable={task.id === tabbableTaskId}
                    onSelect={() => select(backendId, task.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>

    {drawThings.showModelsModal && (
      <DrawThingsModelsModal
        onClose={drawThings.closeModelsModal}
      />
    )}
    </>
  )
}

const TASK_RESULT_ACTIONS = ['thumbnail', 'preview', 'retry', 'export', 'remove', 'restore', 'delete'] as const

const CLOSE_RESULT_LABELS: Record<(typeof TASK_RESULT_ACTIONS)[number], MessageKey> = {
  thumbnail: 'task.closeResult.thumbnail',
  preview: 'task.closeResult.preview',
  retry: 'task.closeResult.retry',
  export: 'task.closeResult.export',
  remove: 'task.closeResult.remove',
  restore: 'task.closeResult.restore',
  delete: 'task.closeResult.delete',
}

function retryQueueTask(backendId: BackendId, taskId: string, runTaskAction: ReturnType<typeof useSelection>['runTaskAction']): void {
  void runTaskAction({
    taskId,
    action: 'retry',
    message: 'task.retryFailed',
    diagnosticMessage: 'Failed to retry task',
    invoke: () => window.electronAPI.retryTask(backendId, taskId),
  })
}

function TaskItem({ task, backendId, isSelected, isTabbable, onSelect, position, total, pendingCompletion, finishCompletion }: { task: Task; backendId: BackendId; isSelected: boolean; isTabbable: boolean; onSelect: () => void; position: number; total: number; pendingCompletion: boolean; finishCompletion: (taskId: string, reveal: boolean) => void }): React.JSX.Element {
  const {
    removeTask,
    restoreTask,
    deleteTask,
    taskActionResults,
    reportTaskActionFailure,
    clearTaskActionResult,
    runTaskAction,
  } = useSelection()
  const { t, text } = useI18n()
  const itemRef = useRef<HTMLButtonElement>(null)
  // The thumbnail streams from the app's image scheme and loads lazily, so only
  // rows on screen read and decode their image, off the main process's thread.
  const hasThumbnail = (task.status === 'completed' || task.status === 'kept') && !!task.baseName
  const thumbnailFrameRef = useRef<HTMLDivElement>(null)
  const [thumbnailSize, setThumbnailSize] = useState({ width: 0, pixelRatio: window.devicePixelRatio })
  useEffect(() => {
    const frame = thumbnailFrameRef.current
    if (!frame) {
      setThumbnailSize({ width: 0, pixelRatio: window.devicePixelRatio })
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setThumbnailSize({ width: entry.contentRect.width, pixelRatio: window.devicePixelRatio })
    })
    // Moving between displays can change physical density without changing the
    // frame's CSS width; resize updates the request's pixel budget too.
    const updateDensity = (): void => {
      setThumbnailSize((current) => ({ ...current, pixelRatio: window.devicePixelRatio }))
    }
    observer.observe(frame)
    window.addEventListener('resize', updateDensity)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateDensity)
    }
  }, [hasThumbnail])
  const thumbUrl = hasThumbnail && thumbnailSize.width > 0
    ? thumbnailUrl(currentSessionImageUrl(task.baseName!), thumbnailSize.width, thumbnailSize.pixelRatio)
    : null

  useLayoutEffect(() => {
    if (pendingCompletion && !task.baseName) finishCompletion(task.id, true)
  }, [pendingCompletion, task.baseName, task.id, finishCompletion])

  const handleRemove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void removeTask(backendId, task.id)
  }
  const handleRestore = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void restoreTask(backendId, task.id)
  }
  const handleDelete = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void deleteTask(backendId, task.id)
  }
  const handleRetry = (e: React.MouseEvent): void => {
    e.stopPropagation()
    retryQueueTask(backendId, task.id, runTaskAction)
  }
  const getExt = (): string => task.imagePath?.split('.').pop() ?? 'png'
  const handleExport = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!task.baseName) return
    void runTaskAction({
      taskId: task.id,
      action: 'export',
      message: 'task.exportFailed',
      diagnosticMessage: 'Failed to export task image',
      invoke: () => window.electronAPI.exportImage(task.baseName!, getExt()),
    })
  }
  // Keeping and removing are the same gesture at different ends of a task's
  // life — file a finished image away, or drop one that never ran — so they
  // share a button and differ only in icon and wording.
  const keeping = task.status === 'completed'
  const removeIcon = keeping ? 'archive' : 'close'
  const removeTitle = t(keeping ? 'task.keepHint' : 'task.removeHint')
  const statusLabel = taskStatusLabel(t, task.status)
  const failureMessage = taskFailureText({ t, text }, task)
  const visibleActionResults = TASK_RESULT_ACTIONS.flatMap((action) => {
    const message = taskActionResults[task.id]?.[action]
    return message ? [{ action, message: t(message) }] : []
  })

  // One-line prompt preview: flatten the (possibly multiline) prompt to a single
  // line and cap the carried text at a generous grapheme budget. CSS still does
  // the visual ellipsis; the full prompt stays in the title tooltip.
  const promptPreview = truncate(task.prompt, PROMPT_PREVIEW_MIN_GRAPHEMES).text
  const promptId = `task-prompt-${task.id}`
  const statusId = `task-status-${task.id}`

  return (
    // The selectable button is an invisible full-cover overlay: real
    // interactive controls (the hover actions) can't nest inside a <button>,
    // so the visible card — thumbnail, prompt, status — renders as a sibling
    // "task-visual" instead of as the button's own content. task-visual takes
    // no pointer events, so the absolutely positioned button (inset: 0)
    // receives every click and hover on the row, while .task-actions
    // (pointer-events restored, position: relative and later in the tree)
    // sits above the button wherever it overlaps — its buttons stay
    // clickable. The button's accessible name comes from aria-labelledby since
    // it no longer contains the prompt/status text itself.
    <div className={`task-entry${task.status === 'kept' ? ' task-entry-kept' : ''}`} role="listitem" aria-posinset={position} aria-setsize={total} data-task-row-id={task.id}>
      <div className="task-row-owner">
      <button
        type="button"
        className={[
          'task-item',
          isSelected ? 'task-item-selected' : '',
        ].filter(Boolean).join(' ')}
        ref={itemRef}
        aria-pressed={isSelected}
        aria-labelledby={`${promptId} ${statusId}`}
        tabIndex={isTabbable ? 0 : -1}
        onClick={onSelect}
        // A double-click opens the fullscreen view, as Space does; its first
        // click has already selected the row.
        onDoubleClick={() => { if (canShowImage(task)) window.dispatchEvent(new CustomEvent(FULLSCREEN_VIEW_TOGGLE_EVENT)) }}
        // Activation follows focus: Tab-ing into the column (or focusing a row any
        // other way) commits that row as the selection, the single source of truth
        // the arrows and command keys then read. `select` only sets state — it
        // never moves focus — so this can't recurse with the nav focus-follow.
        onFocus={onSelect}
        data-task-id={task.id}
      />
      <div className="task-visual">
        {hasThumbnail && (
          <div className="task-thumbnail-frame" ref={thumbnailFrameRef}>
            {thumbUrl && <img
              className="task-thumbnail"
              src={thumbUrl}
              alt=""
              loading={pendingCompletion ? 'eager' : 'lazy'}
              decoding="async"
              onError={() => {
                finishCompletion(task.id, false)
                reportTaskActionFailure(task.id, 'thumbnail', 'task.thumbnailFailed', 'Failed to load task thumbnail', new Error(`Thumbnail request failed for ${task.baseName}`))
              }}
              onLoad={() => {
                clearTaskActionResult(task.id, 'thumbnail')
                finishCompletion(task.id, true)
              }}
            />}
          </div>
        )}
        <div className="task-info">
          {/* Per-item close/dismiss/remove convention (xalign): the hover
              action group — including the plain "close" X on task-btn-warn,
              when this row has one — sits on the PROMPT line, the card's
              first text line, in every state. Sharing this flex row with
              .task-prompt (flex: 1, min-width: 0, ellipsis) is what keeps it
              there with no layout measurement: the prompt's own available
              width simply shrinks by the action group's real rendered width,
              below a thumbnail or not. */}
          <div className="task-prompt-row">
            <div className="task-prompt" id={promptId} title={task.prompt}>
              {promptPreview}
            </div>
            {/* Pointer-only affordances (tabIndex -1); keyboard commands
                operate on the selected row via the cover button above. */}
            <div className={`task-actions${hasThumbnail ? ' task-actions-overlay' : ''}`}>
              {(task.status === 'failed' || task.status === 'interrupted') && (
                <button tabIndex={-1} className="task-btn task-btn-retry" onClick={handleRetry} title={t('task.retry')} aria-label={t('task.retry')}>
                  <Icon name="retry" />
                </button>
              )}
              {(task.status === 'completed' || task.status === 'kept') && task.baseName && (
                <button tabIndex={-1} className="task-btn task-btn-exp" onClick={handleExport} title={t('task.exportHint')} aria-label={t('task.export')}>
                  <Icon name="export" />
                </button>
              )}
              {task.status === 'kept' && (
                <button tabIndex={-1} className="task-btn task-btn-restore" onClick={handleRestore} title={t('task.restoreHint')} aria-label={t('task.restore')}>
                  <Icon name="restore" />
                </button>
              )}
              {task.status !== 'generating' && task.status !== 'kept' && (
                <button tabIndex={-1} className="task-btn task-btn-warn" onClick={handleRemove} title={removeTitle} aria-label={t(keeping ? 'task.keep' : 'task.remove')}>
                  <Icon name={removeIcon} />
                </button>
              )}
              {(task.status === 'completed' || task.status === 'kept') && (
                <button tabIndex={-1} className="task-btn task-btn-danger" onClick={handleDelete} title={t('task.deleteHint')} aria-label={t('task.delete')}>
                  <Icon name="trash" />
                </button>
              )}
            </div>
          </div>
          <div className="task-status" id={statusId} style={{ color: STATUS_COLORS[task.status] }}>
            <span className={task.status === 'failed' ? 'task-error' : undefined}>
              {failureMessage ?? statusLabel}
            </span>
          </div>
        </div>
      </div>
      </div>
      {visibleActionResults.length > 0 && (
        <div className="task-action-results">
          {visibleActionResults.map(({ action, message }) => (
            <div className="task-action-result" role="alert" key={action}>
              <span>{message}</span>
              <button
                type="button"
                className="task-action-result-close"
                aria-label={t(CLOSE_RESULT_LABELS[action])}
                title={t('common.close')}
                onClick={(event) => {
                  event.stopPropagation()
                  clearTaskActionResult(task.id, action)
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
