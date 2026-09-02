import { useCallback, useEffect, useRef, useState } from 'react'
import { type Task } from '../../../shared/types'
import { useSettings } from '../context/SettingsContext'
import { useUiState } from '../context/UiStateContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import { useVisiblePanes } from '../hooks/useVisiblePanes'
import { Icon } from './Icon'
import { useImeGuard } from '../utils/imeGuard'
import { truncate, PROMPT_PREVIEW_MIN_GRAPHEMES } from '../../../shared/textCleanup'
import { hasMod, isEditableTarget, shadowsMacTextBinding } from '../utils/shortcuts'
import { isAnyModalOpen } from './modalStack'
import { taskParameterLabel, taskStatusLabel } from '../utils/taskPresentation'
import { serializeError } from '../../../shared/serialize-error'
import { AdvancedPromptingModal } from './AdvancedPromptingModal'
import { NotificationVolumeSlider } from './NotificationVolumeSlider'
import './PromptPane.css'

interface Props {
  selectedTask: Task | null
  previewDataUrl: string | null
  prompt: string
  onPromptChange: (p: string) => void
}

type PromptPaneAction =
  | 'paste-text'
  | 'copy-prompt'
  | 'reveal-image'
  | 'copy-image'
  | 'export-image'
  | 'save-image-as'

const PROMPT_ACTIONS: readonly PromptPaneAction[] = ['paste-text']
const PREVIEW_ACTIONS: readonly PromptPaneAction[] = [
  'copy-prompt',
  'reveal-image',
  'copy-image',
  'export-image',
  'save-image-as',
]

function logActionFailure(action: PromptPaneAction, error: unknown): void {
  void window.electronAPI.appLog('error', 'Prompt pane action failed', {
    action,
    error: serializeError(error),
  }).catch((logError) => {
    console.error('Failed to forward prompt pane action error to the session log', logError)
  })
}

function ActionFailures({
  actions,
  failures,
  onDismiss,
}: {
  actions: readonly PromptPaneAction[]
  failures: Partial<Record<PromptPaneAction, string>>
  onDismiss: (action: PromptPaneAction) => void
}): React.JSX.Element | null {
  const visible = actions.flatMap((action) => {
    const message = failures[action]
    return message ? [{ action, message }] : []
  })
  if (visible.length === 0) return null

  return (
    <div className="prompt-action-failures">
      {visible.map(({ action, message }) => (
        <div className="prompt-action-failure" role="alert" key={action}>
          <span>{message}</span>
          <button
            type="button"
            className="prompt-action-failure-dismiss"
            aria-label={`Close result: ${message}`}
            title="Close"
            onClick={() => onDismiss(action)}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function PromptPane({ selectedTask, previewDataUrl, prompt, onPromptChange }: Props): React.JSX.Element {
  const { settings, saveNotificationField } = useSettings()
  // Column shortcuts follow what is drawn: Cmd+2 is the second VISIBLE column.
  const { backends: visibleBackends } = useVisiblePanes()
  const { enqueueToBackend, enqueueToAll } = useEnqueueConfigs()
  const isImeComposing = useImeGuard()

  const notificationCfg = ((settings?.notifications ?? {}) as Record<string, unknown>)
  const notificationsEnabled = (notificationCfg.notifications_enabled as boolean) ?? true
  const soundsEnabled = (notificationCfg.sounds_enabled as boolean) ?? true
  // Volume is state, not config — it lives in state.json beside the pane width.
  const { uiState, patchUiState } = useUiState()

  const persistNotificationField = useCallback((field: string, value: unknown): void => {
    void saveNotificationField(field, value)
  }, [saveNotificationField])

  const handleSendToAll = useCallback(() => {
    enqueueToAll(prompt)
  }, [prompt, enqueueToAll])

  const [promptCopied, setPromptCopied] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)
  const [exported, setExported] = useState(false)
  const [clipboardTextAvailable, setClipboardTextAvailable] = useState(false)
  const [actionFailures, setActionFailures] = useState<Partial<Record<PromptPaneAction, string>>>({})
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const detailsRef = useRef<HTMLDivElement>(null)

  // Scroll expanded details into view
  useEffect(() => {
    if (detailsOpen && detailsRef.current) {
      detailsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [detailsOpen])

  // Reset feedback states when selection changes
  useEffect(() => {
    setPromptCopied(false)
    setImageCopied(false)
    setExported(false)
    setActionFailures((current) => {
      const next = { ...current }
      for (const action of PREVIEW_ACTIONS) delete next[action]
      return next
    })
  }, [selectedTask?.id])

  const reportActionFailure = useCallback((
    action: PromptPaneAction,
    message: string,
    error: unknown,
  ): void => {
    logActionFailure(action, error)
    setActionFailures((current) => ({ ...current, [action]: message }))
  }, [])

  const clearActionFailure = useCallback((action: PromptPaneAction): void => {
    setActionFailures((current) => {
      if (!current[action]) return current
      const next = { ...current }
      delete next[action]
      return next
    })
  }, [])

  const getExt = useCallback(
    () => selectedTask?.imagePath?.split('.').pop() ?? 'png',
    [selectedTask]
  )

  const handleCopyPrompt = useCallback((): void => {
    if (!selectedTask?.prompt) return
    void navigator.clipboard.writeText(selectedTask.prompt)
      .then(() => {
        clearActionFailure('copy-prompt')
        setPromptCopied(true)
        setClipboardTextAvailable(true)
        setTimeout(() => setPromptCopied(false), 1500)
      })
      .catch((error) => reportActionFailure(
        'copy-prompt',
        'Couldn’t copy the prompt. Try Copy Prompt again.',
        error,
      ))
  }, [selectedTask, clearActionFailure, reportActionFailure])

  const handleReveal = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.revealFile(selectedTask.baseName, getExt())
      .then(() => clearActionFailure('reveal-image'))
      .catch((error) => reportActionFailure(
        'reveal-image',
        'Couldn’t reveal this image. Try Reveal again.',
        error,
      ))
  }, [selectedTask, getExt, clearActionFailure, reportActionFailure])

  const handleCopyImage = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.copyImageToClipboard(selectedTask.baseName, getExt())
      .then(() => {
        clearActionFailure('copy-image')
        setImageCopied(true)
        void window.electronAPI.hasClipboardText()
          .then(setClipboardTextAvailable)
          .catch(() => setClipboardTextAvailable(false))
        setTimeout(() => setImageCopied(false), 1500)
      })
      .catch((error) => reportActionFailure(
        'copy-image',
        'Couldn’t copy this image. Try Copy to Clipboard again.',
        error,
      ))
  }, [selectedTask, getExt, clearActionFailure, reportActionFailure])

  const handleExport = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.exportImage(selectedTask.baseName, getExt())
      .then(() => {
        clearActionFailure('export-image')
        setExported(true)
        setTimeout(() => setExported(false), 1500)
      })
      .catch((error) => reportActionFailure(
        'export-image',
        'Couldn’t export this image. Check the export folder and try again.',
        error,
      ))
  }, [selectedTask, getExt, clearActionFailure, reportActionFailure])

  const handleSaveAs = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.exportImageAs(selectedTask.baseName, getExt())
      .then((destination) => {
        if (destination !== null) clearActionFailure('save-image-as')
      })
      .catch((error) => reportActionFailure(
        'save-image-as',
        'Couldn’t save this image. Choose Save As again.',
        error,
      ))
  }, [selectedTask, getExt, clearActionFailure, reportActionFailure])

  const refreshClipboardTextAvailable = useCallback((): void => {
    void window.electronAPI.hasClipboardText()
      .then(setClipboardTextAvailable)
      .catch(() => setClipboardTextAvailable(false))
  }, [])

  const handlePasteClipboardText = useCallback((): void => {
    void window.electronAPI.readClipboardText()
      .then((clipboardText) => {
        clearActionFailure('paste-text')
        if (!clipboardText.trim()) {
          setClipboardTextAvailable(false)
          return
        }
        onPromptChange(clipboardText)
        setClipboardTextAvailable(true)
      })
      .catch((error) => reportActionFailure(
        'paste-text',
        'Couldn’t read text from the clipboard. Try Paste Text again.',
        error,
      ))
  }, [onPromptChange, clearActionFailure, reportActionFailure])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // These are window-level shortcuts that queue work or mutate the prompt;
      // a modal owns the keyboard while it is open, so stay out of its way.
      if (isAnyModalOpen()) return
      // No prompt action (send, paste, enqueue) should fire while an IME
      // candidate is being composed — that key belongs to the composition.
      if (isImeComposing(e)) return

      if (isEditableTarget(e.target) && shadowsMacTextBinding(e)) return

      const mod = hasMod(e)

      if (mod && e.key === 'Enter') {
        e.preventDefault()
        handleSendToAll()
        return
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (clipboardTextAvailable) {
          handlePasteClipboardText()
        }
        return
      }
      if (mod && e.key >= '1' && e.key <= '9') {
        const backend = visibleBackends[parseInt(e.key) - 1]
        if (!backend) return
        e.preventDefault()
        enqueueToBackend(backend, prompt)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prompt, clipboardTextAvailable, handleSendToAll, handlePasteClipboardText, enqueueToBackend, isImeComposing])

  useEffect(() => {
    refreshClipboardTextAvailable()

    const intervalId = window.setInterval(() => {
      refreshClipboardTextAvailable()
    }, 1000)

    const handleFocus = (): void => {
      refreshClipboardTextAvailable()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
    }
  }, [refreshClipboardTextAvailable])

  return (
    <div className="prompt-pane">
      <div className="prompt-scroll">
        <div className="prompt-advanced-row">
          <button
            className="prompt-advanced-btn"
            disabled={!clipboardTextAvailable}
            onClick={handlePasteClipboardText}
          >
            Paste Text
          </button>
          <button className="prompt-advanced-btn" onClick={() => setShowAdvanced(true)}>
            Advanced Prompting
          </button>
        </div>
        <ActionFailures
          actions={PROMPT_ACTIONS}
          failures={actionFailures}
          onDismiss={clearActionFailure}
        />
        <textarea
          className="prompt-textarea"
          rows={3}
          placeholder="Enter your image prompt..."
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
        />

        <div className="prompt-actions">
          <label className="notification-check">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => persistNotificationField('notifications_enabled', e.target.checked)}
            />
            Notify
          </label>
          <label className="notification-check">
            <input
              type="checkbox"
              checked={soundsEnabled}
              onChange={(e) => persistNotificationField('sounds_enabled', e.target.checked)}
            />
            Sound
          </label>
          <NotificationVolumeSlider
            className="notification-volume"
            value={uiState.notificationVolume}
            onCommit={(notificationVolume) => patchUiState({ notificationVolume })}
          />
          <button className="send-all" disabled={!prompt.trim()} onClick={handleSendToAll}>
            Send to All
          </button>
        </div>

        <div className="preview-area">
          {previewDataUrl ? (
            <img className="preview-image" src={previewDataUrl} alt="Generated" />
          ) : (
            <div className="preview-placeholder">
              <p>No image selected</p>
              <p className="preview-placeholder-hint">
                Generate an image and click its thumbnail to preview
              </p>
            </div>
          )}
        </div>

        {(selectedTask?.status === 'completed' || selectedTask?.status === 'kept') && selectedTask?.baseName && (
          <div className="preview-toolbar">
            <button className="preview-btn preview-btn-neutral" onClick={handleCopyPrompt}>{promptCopied ? <><Icon name="check" /> Copied</> : 'Copy Prompt'}</button>
            <button className="preview-btn preview-btn-neutral" onClick={handleReveal}>Reveal</button>
            <button className="preview-btn preview-btn-neutral" onClick={handleCopyImage}>{imageCopied ? <><Icon name="check" /> Copied</> : 'Copy to Clipboard'}</button>
            <button className="preview-btn preview-btn-export" onClick={handleExport}>{exported ? <><Icon name="check" /> Exported</> : 'Export'}</button>
            <button className="preview-btn preview-btn-export" onClick={handleSaveAs}>Save As…</button>
          </div>
        )}
        <ActionFailures
          actions={PREVIEW_ACTIONS}
          failures={actionFailures}
          onDismiss={clearActionFailure}
        />
      </div>

      {showAdvanced && (
        <AdvancedPromptingModal
          onClose={() => setShowAdvanced(false)}
        />
      )}

      {selectedTask && (
        <div ref={detailsRef} className="metadata-section">
          {!detailsOpen ? (
            <button className="metadata-toggle" onClick={() => setDetailsOpen(true)}>
              <Icon name="chevron-right" className="metadata-toggle-chevron" />
              <span className="metadata-toggle-model">{selectedTask.model}</span>
              <span className="metadata-toggle-sep"> · </span>
              {/* One-line prompt preview: flatten + cap to a generous budget; CSS
                  clamps visually, the full prompt lives in the title tooltip. */}
              <span className="metadata-toggle-prompt" title={selectedTask.prompt}>
                {truncate(selectedTask.prompt, PROMPT_PREVIEW_MIN_GRAPHEMES).text}
              </span>
            </button>
          ) : (
            <div className="preview-metadata" onClick={() => setDetailsOpen(false)}>
              <div><strong>Model:</strong> {selectedTask.model}</div>
              <div><strong>Status:</strong> {taskStatusLabel(selectedTask.status)}</div>
              <div><strong>Prompt:</strong> {selectedTask.prompt}</div>
              {selectedTask.durationMs !== null && (
                <div><strong>Time:</strong> {(selectedTask.durationMs / 1000).toFixed(1)}s</div>
              )}
              {(() => {
                const p = selectedTask.params
                const rows: React.ReactNode[] = []
                if (p.width != null && p.height != null) {
                  rows.push(<div key="size"><strong>Size:</strong> {String(p.width)}×{String(p.height)}</div>)
                }
                const skip = new Set(['width', 'height'])
                for (const [k, v] of Object.entries(p)) {
                  if (skip.has(k) || v == null || v === '') continue
                  rows.push(<div key={k}><strong>{taskParameterLabel(k)}:</strong> {String(v)}</div>)
                }
                return rows
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
