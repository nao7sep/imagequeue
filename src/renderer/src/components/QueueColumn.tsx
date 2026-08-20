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
import { truncate, PROMPT_PREVIEW_MIN_GRAPHEMES } from '../utils/textCleanup'
import { useAutosavedImageBackendDefaults } from '../hooks/useAutosavedImageBackendDefaults'
import {
  resolveSavedImageBackendDefaults,
  type SavedImageBackendDefaults,
} from '../utils/imageBackendDefaults'
import { hasApiKeyFor, isBackendReadyToEnqueue } from '../utils/enqueue'
import { isFreshCompletion } from '../utils/taskScroll'
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
  const { tasks } = useQueue()
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

  useAutosavedImageBackendDefaults({
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

  // This column is the board's listbox: its `.task-list` is one tab stop, and
  // while it has focus it owns all four arrows plus Home/End for navigation and
  // the scoped command keys for the selected task. Navigation (Up/Down within,
  // Left/Right to the adjacent column) is delegated to SelectionContext, which
  // keeps the single source of truth and follows focus to the moved-to row.
  // Backspace/Delete/Space form the command layer, scoped here so they act only
  // while focus is inside the queue — they read the selection from the context,
  // never from the DOM.
  const handleListKeyDown = useCallback((e: React.KeyboardEvent): void => {
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
            <label>model</label>
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
          + Queue
        </button>
      </div>

      <div
        className="task-list"
        role="listbox"
        aria-label={`${label} queue`}
        onKeyDown={handleListKeyDown}
        onClick={(e) => { if (e.target === e.currentTarget) clear() }}
      >
        {columnTasks.length === 0 ? (
          <div className="task-list-empty">No tasks queued</div>
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

function TaskItem({ task, backendId, isSelected, isTabbable, onSelect }: { task: Task; backendId: BackendId; isSelected: boolean; isTabbable: boolean; onSelect: () => void }): React.JSX.Element {
  const { removeTask, restoreTask, deleteTask } = useSelection()
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  // Seeded with the status at mount so an item that is *already* completed or
  // kept when it first renders — app launch restoring stored tasks, or the user
  // revealing kept images with ⌘⇧K — is not mistaken for a fresh completion.
  const prevStatusRef = useRef(task.status)
  // Armed on a genuine completion transition; consumed by the thumbnail's
  // onLoad so the scroll runs against the item's final height.
  const justCompletedRef = useRef(false)

  useEffect(() => {
    if ((task.status !== 'completed' && task.status !== 'kept') || !task.baseName) return
    window.electronAPI.getImage(task.baseName).then((result) => {
      if (result) {
        const mime = result.ext === 'jpg' ? 'image/jpeg' : `image/${result.ext}`
        setThumbUrl(`data:${mime};base64,${result.data}`)
      }
    })
  }, [task.status, task.baseName])

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
    window.electronAPI.retryTask(backendId, task.id)
  }
  const getExt = (): string => task.imagePath?.split('.').pop() ?? 'png'
  const handleExport = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!task.baseName) return
    void window.electronAPI.exportImage(task.baseName, getExt())
  }
  // Keeping and removing are the same gesture at different ends of a task's
  // life — file a finished image away, or drop one that never ran — so they
  // share a button and differ only in icon and wording.
  const keeping = task.status === 'completed'
  const removeIcon = keeping ? 'archive' : 'close'
  const removeTitle = keeping ? 'Keep — file this image away, out of the active list' : 'Remove from queue'
  const statusLabel = task.status === 'kept' ? 'kept' : task.status

  // One-line prompt preview: flatten the (possibly multiline) prompt to a single
  // line and cap the carried text at a generous grapheme budget. CSS still does
  // the visual ellipsis; the full prompt stays in the title tooltip.
  const promptPreview = truncate(task.prompt, PROMPT_PREVIEW_MIN_GRAPHEMES).text

  return (
    <div
      className={[
        'task-item',
        task.status === 'kept' ? 'task-item-kept' : '',
        isSelected ? 'task-item-selected' : ''
      ].filter(Boolean).join(' ')}
      ref={itemRef}
      role="option"
      aria-selected={isSelected}
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
              ? `failed: ${task.error || 'unknown error'}`
              : task.status === 'interrupted'
                ? 'interrupted'
                : statusLabel}
          </span>
        </div>
      </div>
      {/* Per-row actions are pointer-only affordances (tabIndex -1), never tab
          stops inside the listbox: the keyboard reaches them via the column's
          command keys (Backspace removes/keeps/restores, Delete deletes) on the
          active row. This keeps the column a single tab stop. */}
      <div className="task-actions">
        {/* Icon buttons, not text chips: at a row's scale a word has to shrink
            to ~11px to fit, which is where the old `keep`/`rm`/`exp` affordances
            became unreadable. The accessible name lives on the button (the icon
            is aria-hidden), and the title carries the same words as before. */}
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
    </div>
  )
}
