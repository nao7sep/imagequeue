import { isStorageStillPending } from '../../../shared/storage-wait'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { type Task } from '../../../shared/types'
import { useSettings } from '../context/SettingsContext'
import { useUiState } from '../context/UiStateContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import { useVisiblePanes } from '../hooks/useVisiblePanes'
import { Icon } from './Icon'
import { useImeGuard } from '../utils/imeGuard'
import { truncate, PROMPT_PREVIEW_MIN_GRAPHEMES } from '../../../shared/textCleanup'
import { isEditableTarget, shadowsMacTextBinding, windowCommandFor } from '../utils/shortcuts'
import { isAnyModalOpen, onModalOpenChange } from './modalStack'
import { taskParameterLabel, taskStatusLabel } from '../utils/taskPresentation'
import { selectedImageOf, type SelectedImage, type WindowCommand } from '../../../shared/viewing'
import { useSelection } from '../context/SelectionContext'
import { Preview } from './Preview'
import { serializeError } from '../../../shared/serialize-error'
import { AdvancedPromptingModal } from './AdvancedPromptingModal'
import { NotificationVolumeSlider } from './NotificationVolumeSlider'
import './PromptPane.css'
import { useI18n } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'

interface Props {
  selectedTask: Task | null
  prompt: string
  onPromptChange: (p: string) => void
}

type PromptPaneAction =
  | 'notifications_enabled'
  | 'sounds_enabled'
  | 'paste-text'
  | 'copy-prompt'
  | 'reveal-image'
  | 'copy-image'
  | 'export-image'
  | 'save-image-as'

const PROMPT_ACTIONS: readonly PromptPaneAction[] = ['paste-text', 'notifications_enabled', 'sounds_enabled']
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
  failures: Partial<Record<PromptPaneAction, MessageKey>>
  onDismiss: (action: PromptPaneAction) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const visible = actions.flatMap((action) => {
    const key = failures[action]
    return key ? [{ action, message: t(key) }] : []
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
            aria-label={t('prompt.closeResult', { message })}
            title={t('common.close')}
            onClick={() => onDismiss(action)}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function PromptPane({ selectedTask, prompt, onPromptChange }: Props): React.JSX.Element {
  const { settings, saveNotificationField } = useSettings()
  const i18n = useI18n()
  const { t } = i18n
  // Column shortcuts follow what is drawn: Cmd+2 is the second VISIBLE column.
  const { backends: visibleBackends } = useVisiblePanes()
  const { enqueueToBackend, enqueueToAll } = useEnqueueConfigs()
  const isImeComposing = useImeGuard()

  const notificationCfg = ((settings?.notifications ?? {}) as Record<string, unknown>)
  const notificationsEnabled = (notificationCfg.notifications_enabled as boolean) ?? true
  const soundsEnabled = (notificationCfg.sounds_enabled as boolean) ?? true
  // Volume is state, not config — it lives in state.json beside the pane width.
  const { uiState, patchUiState } = useUiState()

  const handleSendToAll = useCallback(() => {
    enqueueToAll(prompt)
  }, [prompt, enqueueToAll])

  const [notificationSaving, setNotificationSaving] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)
  const [exported, setExported] = useState(false)
  const [clipboardTextAvailable, setClipboardTextAvailable] = useState(false)
  const [actionFailures, setActionFailures] = useState<Partial<Record<PromptPaneAction, MessageKey>>>({})
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const detailsRef = useRef<HTMLDivElement>(null)
  const detailsId = useId()
  const [readyImage, setReadyImage] = useState<SelectedImage | null>(null)

  // A details row: its label in bold with the language's own punctuation, then
  // the value. Values are the task's own data, shown as stored.
  const detailRow = (label: string, value: string): React.ReactNode =>
    <><strong>{t('details.label', { label })}</strong> {value}</>
  const oneDecimal = new Intl.NumberFormat(i18n.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  // Scroll expanded details into view
  useEffect(() => {
    if (detailsOpen && detailsRef.current) {
      detailsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [detailsOpen])

  // Identity alone is insufficient when selection goes A -> B -> A while an
  // export is pending. Every selection visit owns its own feedback generation.
  const exportSelection = useRef({ id: selectedTask?.id, generation: 0 })
  if (exportSelection.current.id !== selectedTask?.id) {
    exportSelection.current = { id: selectedTask?.id, generation: exportSelection.current.generation + 1 }
  }
  const exportAttempts = useRef({ export: 0, saveAs: 0 })
  useEffect(() => () => { exportSelection.current.generation += 1 }, [])

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
    message: MessageKey,
    error: unknown,
  ): void => {
    logActionFailure(action, error)
    setActionFailures((current) => ({ ...current, [action]: isStorageStillPending(error) ? 'storage.stillPending' : message }))
  }, [])

  const clearActionFailure = useCallback((action: PromptPaneAction): void => {
    setActionFailures((current) => {
      if (!current[action]) return current
      const next = { ...current }
      delete next[action]
      return next
    })
  }, [])

  const persistNotificationField = useCallback((field: 'notifications_enabled' | 'sounds_enabled', value: boolean): void => {
    setNotificationSaving(true)
    void saveNotificationField(field, value)
      .then(() => clearActionFailure(field))
      .catch((error) => reportActionFailure(field, 'failure.settingsSave', error))
      .finally(() => setNotificationSaving(false))
  }, [saveNotificationField, clearActionFailure, reportActionFailure])

  // The image either loaded or did not; a failure stays on the task, as a
  // thumbnail's does, until a later load of it succeeds.
  const { reportTaskActionFailure, clearTaskActionResult } = useSelection()
  const selectedImage = useMemo(() => selectedImageOf(selectedTask), [selectedTask])
  const imageActionsReady = selectedImage !== null && readyImage === selectedImage
  const handleImageLoad = useCallback((taskId: string, loaded: boolean): void => {
    if (loaded) clearTaskActionResult(taskId, 'preview')
    else reportTaskActionFailure(taskId, 'preview', 'task.previewFailed', 'Failed to load selected image', new Error(`The image of task ${taskId} did not load`))
  }, [clearTaskActionResult, reportTaskActionFailure])

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
        'prompt.copyPromptFailed',
        error,
      ))
  }, [selectedTask, clearActionFailure, reportActionFailure])

  const handleReveal = useCallback((): void => {
    if (!imageActionsReady || !selectedTask?.baseName) return
    void window.electronAPI.revealFile(selectedTask.baseName, getExt())
      .then(() => clearActionFailure('reveal-image'))
      .catch((error) => reportActionFailure(
        'reveal-image',
        'prompt.revealFailed',
        error,
      ))
  }, [selectedTask, imageActionsReady, getExt, clearActionFailure, reportActionFailure])

  const handleCopyImage = useCallback((): void => {
    if (!imageActionsReady || !selectedTask?.baseName) return
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
        'prompt.copyImageFailed',
        error,
      ))
  }, [selectedTask, imageActionsReady, getExt, clearActionFailure, reportActionFailure])

  const handleExport = useCallback((): void => {
    if (!imageActionsReady || !selectedTask?.baseName) return
    const generation = exportSelection.current.generation
    const attempt = ++exportAttempts.current.export
    const current = (): boolean => exportSelection.current.generation === generation && exportAttempts.current.export === attempt
    void window.electronAPI.exportImage(selectedTask.baseName, getExt())
      .then(() => {
        if (!current()) return
        clearActionFailure('export-image')
        setExported(true)
        setTimeout(() => { if (current()) setExported(false) }, 1500)
      })
      .catch((error) => current() ? reportActionFailure(
        'export-image',
        'task.exportFailed',
        error,
      ) : logActionFailure('export-image', error))
  }, [selectedTask, imageActionsReady, getExt, clearActionFailure, reportActionFailure])

  const handleSaveAs = useCallback((): void => {
    if (!imageActionsReady || !selectedTask?.baseName) return
    const generation = exportSelection.current.generation
    const attempt = ++exportAttempts.current.saveAs
    const current = (): boolean => exportSelection.current.generation === generation && exportAttempts.current.saveAs === attempt
    void window.electronAPI.exportImageAs(selectedTask.baseName, getExt())
      .then((destination) => {
        if (current() && destination !== null) clearActionFailure('save-image-as')
      })
      .catch((error) => current() ? reportActionFailure(
        'save-image-as',
        'prompt.saveAsFailed',
        error,
      ) : logActionFailure('save-image-as', error))
  }, [selectedTask, imageActionsReady, getExt, clearActionFailure, reportActionFailure])

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
        'prompt.pasteFailed',
        error,
      ))
  }, [onPromptChange, clearActionFailure, reportActionFailure])

  // Keyboard shortcuts that queue work or mutate the prompt, pressed here or
  // handed on by the preview window. Returns whether the command was this
  // pane's to answer.
  const runCommand = useCallback((command: WindowCommand): boolean => {
    // A modal owns the keyboard while it is open, so stay out of its way.
    if (isAnyModalOpen()) return false
    if (command === 'sendAll') {
      handleSendToAll()
      return true
    }
    if (command === 'paste') {
      if (clipboardTextAvailable) handlePasteClipboardText()
      return true
    }
    if (command.startsWith('send:')) {
      const backend = visibleBackends[Number(command.slice('send:'.length)) - 1]
      if (!backend) return false
      enqueueToBackend(backend, prompt)
      return true
    }
    return false
  }, [prompt, clipboardTextAvailable, handleSendToAll, handlePasteClipboardText, enqueueToBackend, visibleBackends])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // No prompt action (send, paste, enqueue) should fire while an IME
      // candidate is being composed — that key belongs to the composition.
      if (isImeComposing(e)) return
      if (isEditableTarget(e.target) && shadowsMacTextBinding(e)) return
      const command = windowCommandFor(e)
      if (command && runCommand(command)) e.preventDefault()
    }
    window.addEventListener('keydown', handler)
    const stop = window.electronAPI.onWindowCommand((command) => { runCommand(command) })
    return () => {
      window.removeEventListener('keydown', handler)
      stop()
    }
  }, [runCommand, isImeComposing])

  useEffect(() => {
    const refreshIfActive = (): void => {
      if (document.visibilityState === 'visible' && document.hasFocus() && !isAnyModalOpen()) {
        refreshClipboardTextAvailable()
      }
    }
    refreshIfActive()
    const intervalId = window.setInterval(refreshIfActive, 1000)
    window.addEventListener('focus', refreshIfActive)
    document.addEventListener('visibilitychange', refreshIfActive)
    const stopModalListener = onModalOpenChange(refreshIfActive)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshIfActive)
      document.removeEventListener('visibilitychange', refreshIfActive)
      stopModalListener()
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
            {t('prompt.pasteText')}
          </button>
          <button className="prompt-advanced-btn" onClick={() => setShowAdvanced(true)}>
            {t('prompt.advancedPrompting')}
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
          placeholder={t('prompt.placeholder')}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
        />

        <div className="prompt-actions">
          <label className="notification-check">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              disabled={notificationSaving}
              onChange={(e) => persistNotificationField('notifications_enabled', e.target.checked)}
            />
            {t('prompt.notify')}
          </label>
          <label className="notification-check">
            <input
              type="checkbox"
              checked={soundsEnabled}
              disabled={notificationSaving}
              onChange={(e) => persistNotificationField('sounds_enabled', e.target.checked)}
            />
            {t('prompt.sound')}
          </label>
          <NotificationVolumeSlider
            className="notification-volume"
            value={uiState.notificationVolume}
            onCommit={(notificationVolume) => patchUiState({ notificationVolume })}
          />
          <button className="send-all" disabled={!prompt.trim()} onClick={handleSendToAll}>
            {t('prompt.sendToAll')}
          </button>
        </div>

        <Preview task={selectedImage} onImageLoad={handleImageLoad} onReadyToAct={setReadyImage} />

        {(selectedTask?.status === 'completed' || selectedTask?.status === 'kept') && selectedTask?.baseName && (
          <div className="preview-toolbar">
            <button className="preview-btn preview-btn-neutral" onClick={handleCopyPrompt}>{promptCopied ? <><Icon name="check" /> {t('prompt.copied')}</> : t('prompt.copyPrompt')}</button>
            <button className="preview-btn preview-btn-neutral" disabled={!imageActionsReady} onClick={handleReveal}>{t('prompt.reveal')}</button>
            <button className="preview-btn preview-btn-neutral" disabled={!imageActionsReady} onClick={handleCopyImage}>{imageCopied ? <><Icon name="check" /> {t('prompt.copied')}</> : t('prompt.copyImage')}</button>
            <button className="preview-btn preview-btn-export" disabled={!imageActionsReady} onClick={handleExport}>{exported ? <><Icon name="check" /> {t('prompt.exported')}</> : t('prompt.export')}</button>
            <button className="preview-btn preview-btn-export" disabled={!imageActionsReady} onClick={handleSaveAs}>{t('prompt.saveAs')}</button>
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
          <button
            type="button"
            className="metadata-toggle"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <Icon name="chevron-right" className="metadata-toggle-chevron" />
            <span className="metadata-toggle-model">{selectedTask.model}</span>
            <span className="metadata-toggle-sep"> · </span>
            {/* One-line prompt preview: flatten + cap to a generous budget; CSS
                clamps visually, the full prompt lives in the title tooltip. */}
            <span className="metadata-toggle-prompt" title={selectedTask.prompt}>
              {truncate(selectedTask.prompt, PROMPT_PREVIEW_MIN_GRAPHEMES).text}
            </span>
          </button>
          {detailsOpen && (
            // Focusable so the keyboard can scroll a long prompt.
            <div id={detailsId} className="preview-metadata" role="region" tabIndex={0} aria-label={t('details.region')}>
              <div>{detailRow(t('details.model'), selectedTask.model)}</div>
              <div>{detailRow(t('details.status'), taskStatusLabel(t, selectedTask.status))}</div>
              <div>{detailRow(t('details.prompt'), selectedTask.prompt)}</div>
              {selectedTask.durationMs !== null && (
                <div>{detailRow(t('details.time'), t('details.seconds', { seconds: oneDecimal.format(selectedTask.durationMs / 1000) }))}</div>
              )}
              {(() => {
                const p = selectedTask.params
                const rows: React.ReactNode[] = []
                if (p.width != null && p.height != null) {
                  rows.push(<div key="size">{detailRow(t('details.size'), t('details.dimensions', { width: String(p.width), height: String(p.height) }))}</div>)
                }
                const skip = new Set(['width', 'height'])
                for (const [k, v] of Object.entries(p)) {
                  if (skip.has(k) || v == null || v === '') continue
                  rows.push(<div key={k}>{detailRow(taskParameterLabel(t, k), String(v))}</div>)
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
