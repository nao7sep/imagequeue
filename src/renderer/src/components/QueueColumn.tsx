import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSelection } from '../context/SelectionContext'
import { useSettings } from '../context/SettingsContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import type { BackendId, CloudBackendId, Task } from '../../../shared/types'
import { getModelsForBackend, findModel } from '../../../shared/models'
import { CLOUD_BACKENDS } from '../backends'
import { useDrawThingsColumn, DrawThingsControls } from './DrawThingsColumn'
import { DrawThingsModelsModal } from './DrawThingsModelsModal'
import { truncate, PROMPT_PREVIEW_MIN_GRAPHEMES } from '../../../shared/textCleanup'
import { useAutosavedImageBackendDefaults } from '../hooks/useAutosavedImageBackendDefaults'
import {
  resolveSavedImageBackendDefaults,
  type SavedImageBackendDefaults,
} from '../utils/imageBackendDefaults'
import { hasApiKeyFor, isBackendReadyToEnqueue } from '../utils/enqueue'
import { isFreshCompletion } from '../utils/taskScroll'
import { taskStatusLabel } from '../utils/taskPresentation'
import { useImeGuard } from '../utils/imeGuard'
import { Icon } from './Icon'
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
  } = useSelection()
  const isComposing = useImeGuard()
  const { settings, apiKeyPresence, saveImageBackendDefaults } = useSettings()
  const { setSnapshot, enqueueToBackend } = useEnqueueConfigs()
  const models = getModelsForBackend(backendId)
  const defaultModel = models.find((m) => m.isDefault) ?? models[0]
  const [model, setModel] = useState(defaultModel?.id ?? '')
  const proprietaryBackend = backendId === 'drawthings' ? null : backendId as CloudBackendId

  // The cloud backends share one generic parameter path: the descriptor owns
  // this backend's param model (defaults, clamping, enqueue payload, controls)
  // and the column holds a single params object. Draw Things is the one
  // non-descriptor backend — a local CLI with per-model persisted params — and
  // keeps its own state below.
  const cloudBackend = proprietaryBackend ? CLOUD_BACKENDS[proprietaryBackend] : null
  const cloudModelDef = useMemo(
    () => (proprietaryBackend ? findModel(proprietaryBackend, model) ?? models[0] : null),
    [proprietaryBackend, model, models]
  )
  const [cloudParams, setCloudParams] = useState<Record<string, unknown>>(
    () => cloudBackend?.defaults() ?? {}
  )

  // Re-validate the params whenever the model changes: a value the new model
  // does not offer falls to that model's own default (descriptor semantics).
  useEffect(() => {
    if (!cloudBackend || !cloudModelDef) return
    setCloudParams((prev) => cloudBackend.clampToModel(prev, cloudModelDef))
  }, [cloudBackend, cloudModelDef])

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
    currentModel: model,
    currentParams: currentEnqueueParams,
    applySaved: applySavedProprietaryDefaults,
    saveDefaults: saveImageBackendDefaults,
  })

  // Backend-config readiness only (no prompt check — the prompt is validated by
  // the enqueue action). Mirrored into the snapshot so Send-to-All / Cmd+N can
  // skip not-ready backends, and reused for the "+ Queue" button's disabled state.
  const readyToEnqueue = isBackendReadyToEnqueue({
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
  // those buttons has focus, the list owns all four arrows plus Home/End and
  // the scoped command keys for the selected task. Navigation (Up/Down within,
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
      if (task?.status !== 'completed' && task?.status !== 'kept') return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('viewer:toggle'))
    }
  }, [selection, navigate, selectEdge, backendId, tasks, deleteSelected, restoreSelected, removeSelected, isComposing])

  // The single roving tab stop for this column: the selected row when the
  // selection lives here, otherwise the first row. Exactly one option per column
  // is tabbable, so Tab enters the column at the active row and Tab leaves it.
  const tabbableTaskId = selection?.backend === backendId && columnTasks.some((t) => t.id === selection.taskId)
    ? selection.taskId
    : columnTasks[0]?.id ?? null

  return (
    <>
    <div className="queue-column" data-backend={backendId}>
      <div className="column-header">{label}</div>

      <div className="column-settings">
        {backendId !== 'drawthings' && (
          <div className="setting-row">
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* The cloud backends' parameter rows come from this backend's
            descriptor — one generic element instead of a fork per backend. */}
        {cloudBackend && cloudModelDef && (
          <cloudBackend.Controls params={cloudParams} modelDef={cloudModelDef} onChange={setCloudParams} />
        )}

        {cloudDefaultsPersistence.saveFailure && (
          <div className="column-save-result" role="alert">
            <span>{cloudDefaultsPersistence.saveFailure}</span>
            <button
              type="button"
              className="column-save-result-close"
              aria-label="Close settings save result"
              title="Close"
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
          <div className="setting-row model-warning">API key not set</div>
        )}

        <button
          className="enqueue-btn"
          disabled={!hasPrompt || !readyToEnqueue}
          onClick={() => enqueueToBackend(backendId, prompt)}
        >
          <Icon name="plus" /> Queue
        </button>
      </div>

      <div
        className="task-list"
        role="list"
        aria-label={`${label} queue`}
        onKeyDown={handleListKeyDown}
        onClick={(e) => { if (e.target === e.currentTarget) clear() }}
      >
        {columnTasks.length === 0 ? (
          <div className="task-list-empty" role="presentation">
            {loadState === 'loading'
              ? 'Loading queue…'
              : loadState === 'failed'
                ? 'Couldn’t load queued tasks.'
                : 'No tasks queued'}
          </div>
        ) : (
          columnTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              backendId={backendId}
              isSelected={selection?.backend === backendId && selection.taskId === task.id}
              isTabbable={task.id === tabbableTaskId}
              onSelect={() => select(backendId, task.id)}
            />
          ))
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

function TaskItem({ task, backendId, isSelected, isTabbable, onSelect }: { task: Task; backendId: BackendId; isSelected: boolean; isTabbable: boolean; onSelect: () => void }): React.JSX.Element {
  const {
    removeTask,
    restoreTask,
    deleteTask,
    taskActionResults,
    reportTaskActionFailure,
    clearTaskActionResult,
    runTaskAction,
  } = useSelection()
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const itemRef = useRef<HTMLButtonElement>(null)
  // Seeded with the status at mount so an item that is *already* completed or
  // kept when it first renders — app launch restoring stored tasks, or the user
  // revealing kept images with ⌘⇧K — is not mistaken for a fresh completion.
  const prevStatusRef = useRef(task.status)
  // Armed on a genuine completion transition; consumed by the thumbnail's
  // onLoad so the scroll runs against the item's final height.
  const justCompletedRef = useRef(false)

  useEffect(() => {
    if ((task.status !== 'completed' && task.status !== 'kept') || !task.baseName) return
    let active = true
    window.electronAPI.getImage(task.baseName).then((result) => {
      if (!active) return
      clearTaskActionResult(task.id, 'thumbnail')
      if (result) {
        const mime = result.ext === 'jpg' ? 'image/jpeg' : `image/${result.ext}`
        setThumbUrl(`data:${mime};base64,${result.data}`)
      }
    }).catch((error) => {
      if (!active) return
      setThumbUrl(null)
      reportTaskActionFailure(task.id, 'thumbnail', 'This task’s thumbnail could not be loaded. The task is unchanged.', 'Failed to load task thumbnail', error)
    })
    return () => { active = false }
  }, [task.id, task.status, task.baseName, clearTaskActionResult, reportTaskActionFailure])

  // Auto-scroll only on a real queued/generating -> completed transition, so a
  // freshly generated image reveals itself. Mounting an already-completed task
  // or flipping kept items into the list must not move the viewport. A fresh
  // completion always carries a baseName (set together in the processor), so we
  // defer to the thumbnail's onLoad; the no-thumbnail branch is a safety net.
  useEffect(() => {
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = task.status
    if (!isFreshCompletion(prevStatus, task.status)) return
    if (task.baseName) {
      justCompletedRef.current = true
    } else {
      itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [task.status, task.baseName])

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
    void runTaskAction({
      taskId: task.id,
      action: 'retry',
      message: 'The task could not be retried. It remains stopped; try again.',
      diagnosticMessage: 'Failed to retry task',
      invoke: () => window.electronAPI.retryTask(backendId, task.id),
    })
  }
  const getExt = (): string => task.imagePath?.split('.').pop() ?? 'png'
  const handleExport = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!task.baseName) return
    void runTaskAction({
      taskId: task.id,
      action: 'export',
      message: 'The image could not be exported. The original is unchanged; try again.',
      diagnosticMessage: 'Failed to export task image',
      invoke: () => window.electronAPI.exportImage(task.baseName!, getExt()),
    })
  }
  // Keeping and removing are the same gesture at different ends of a task's
  // life — file a finished image away, or drop one that never ran — so they
  // share a button and differ only in icon and wording.
  const keeping = task.status === 'completed'
  const removeIcon = keeping ? 'archive' : 'close'
  const removeTitle = keeping ? 'Keep — file this image away, out of the active list' : 'Remove from queue'
  const statusLabel = taskStatusLabel(task.status)
  const visibleActionResults = TASK_RESULT_ACTIONS.flatMap((action) => {
    const message = taskActionResults[task.id]?.[action]
    return message ? [{ action, message }] : []
  })

  // One-line prompt preview: flatten the (possibly multiline) prompt to a single
  // line and cap the carried text at a generous grapheme budget. CSS still does
  // the visual ellipsis; the full prompt stays in the title tooltip.
  const promptPreview = truncate(task.prompt, PROMPT_PREVIEW_MIN_GRAPHEMES).text

  return (
    // The selectable button, pointer action strip, and retained results are
    // list-item siblings. Result dismissal stays keyboard reachable without
    // adding an interactive descendant to a one-tab-stop composite.
    <div className={`task-entry${task.status === 'kept' ? ' task-entry-kept' : ''}`} role="listitem">
      <button
        type="button"
        className={[
          'task-item',
          task.status === 'kept' ? 'task-item-kept' : '',
          isSelected ? 'task-item-selected' : '',
        ].filter(Boolean).join(' ')}
        ref={itemRef}
        aria-pressed={isSelected}
        tabIndex={isTabbable ? 0 : -1}
        onClick={onSelect}
        // Activation follows focus: Tab-ing into the column (or focusing a row any
        // other way) commits that row as the selection, the single source of truth
        // the arrows and command keys then read. `select` only sets state — it
        // never moves focus — so this can't recurse with the nav focus-follow.
        onFocus={onSelect}
        data-task-id={task.id}
      >
        {thumbUrl && (
          <div className="task-thumbnail-frame">
            <img
              className="task-thumbnail"
              src={thumbUrl}
              alt=""
              onLoad={() => {
                if (!justCompletedRef.current) return
                justCompletedRef.current = false
                itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }}
            />
          </div>
        )}
        <div className="task-info">
          <div className="task-prompt" title={task.prompt}>
            {promptPreview}
          </div>
          <div className="task-status" style={{ color: STATUS_COLORS[task.status] }}>
            <span
              className={task.status === 'failed' ? 'task-error' : undefined}
              title={task.status === 'failed' && task.error ? task.error : undefined}
            >
              {task.status === 'failed'
                ? (task.error || 'This image could not be generated. Retry it; if the problem continues, check the session log.')
                : statusLabel}
            </span>
          </div>
        </div>
      </button>
      {/* Per-row actions are pointer-only affordances (tabIndex -1). Keyboard
          commands operate on the selected row, while these stay outside the
          selectable button so the DOM never nests interactive controls. */}
      <div className="task-actions">
        {(task.status === 'failed' || task.status === 'interrupted') && (
          <button tabIndex={-1} className="task-btn task-btn-retry" onClick={handleRetry} title="Retry" aria-label="Retry">
            <Icon name="retry" />
          </button>
        )}
        {(task.status === 'completed' || task.status === 'kept') && task.baseName && (
          <button tabIndex={-1} className="task-btn task-btn-exp" onClick={handleExport} title="Export to export folder" aria-label="Export">
            <Icon name="export" />
          </button>
        )}
        {task.status === 'kept' && (
          <button tabIndex={-1} className="task-btn task-btn-restore" onClick={handleRestore} title="Restore to active list" aria-label="Restore">
            <Icon name="restore" />
          </button>
        )}
        {task.status !== 'generating' && task.status !== 'kept' && (
          <button tabIndex={-1} className="task-btn task-btn-warn" onClick={handleRemove} title={removeTitle} aria-label={keeping ? 'Keep' : 'Remove'}>
            <Icon name={removeIcon} />
          </button>
        )}
        {(task.status === 'completed' || task.status === 'kept') && (
          <button tabIndex={-1} className="task-btn task-btn-danger" onClick={handleDelete} title="Delete with files" aria-label="Delete">
            <Icon name="trash" />
          </button>
        )}
      </div>
      {visibleActionResults.length > 0 && (
        <div className="task-action-results">
          {visibleActionResults.map(({ action, message }) => (
            <div className="task-action-result" role="alert" key={action}>
              <span>{message}</span>
              <button
                type="button"
                className="task-action-result-close"
                aria-label={`Close ${action} result`}
                title="Close"
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
