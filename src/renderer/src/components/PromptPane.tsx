import { useCallback, useEffect, useRef, useState } from 'react'
import { BACKEND_IDS_IN_UI_ORDER, type Task } from '../../../shared/types'
import { useSettings } from '../context/SettingsContext'
import { AdvancedPromptingModal } from './AdvancedPromptingModal'
import './PromptPane.css'

interface Props {
  selectedTask: Task | null
  previewDataUrl: string | null
  prompt: string
  onPromptChange: (p: string) => void
}

export function PromptPane({ selectedTask, previewDataUrl, prompt, onPromptChange }: Props): React.JSX.Element {
  const { settings, updateSettings } = useSettings()

  const notificationCfg = ((settings?.notifications ?? {}) as Record<string, unknown>)
  const notificationsEnabled = (notificationCfg.notifications_enabled as boolean) ?? true
  const soundsEnabled = (notificationCfg.sounds_enabled as boolean) ?? true
  const volume = (notificationCfg.volume as number) ?? 0.7

  // Local volume state for smooth slider dragging; syncs on pointer up.
  const [localVolume, setLocalVolume] = useState<number>(volume)
  useEffect(() => { setLocalVolume(volume) }, [volume])

  const saveNotificationField = useCallback((field: string, value: unknown): void => {
    if (!settings) return
    const next = {
      ...settings,
      notifications: { ...(settings.notifications as Record<string, unknown> ?? {}), [field]: value }
    }
    void updateSettings(next)
  }, [settings, updateSettings])

  const handleSendToAll = useCallback(() => {
    if (!prompt.trim()) return
    window.dispatchEvent(new CustomEvent('enqueue-all', { detail: { prompt: prompt.trim() } }))
  }, [prompt])

  const [promptCopied, setPromptCopied] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)
  const [exported, setExported] = useState(false)
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
  }, [selectedTask?.id])

  const getExt = useCallback(
    () => selectedTask?.imagePath?.split('.').pop() ?? 'png',
    [selectedTask]
  )

  const handleCopyPrompt = useCallback((): void => {
    if (!selectedTask?.prompt) return
    void navigator.clipboard.writeText(selectedTask.prompt).then(() => {
      setPromptCopied(true)
      setTimeout(() => setPromptCopied(false), 1500)
    })
  }, [selectedTask])

  const handleReveal = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.revealFile(selectedTask.baseName, getExt())
  }, [selectedTask, getExt])

  const handleCopyImage = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.copyImageToClipboard(selectedTask.baseName, getExt()).then(() => {
      setImageCopied(true)
      setTimeout(() => setImageCopied(false), 1500)
    })
  }, [selectedTask, getExt])

  const handleExport = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.exportImage(selectedTask.baseName, getExt()).then(() => {
      setExported(true)
      setTimeout(() => setExported(false), 1500)
    })
  }, [selectedTask, getExt])

  const handleSaveAs = useCallback((): void => {
    if (!selectedTask?.baseName) return
    void window.electronAPI.exportImageAs(selectedTask.baseName, getExt())
  }, [selectedTask, getExt])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key === 'Enter') {
        e.preventDefault()
        handleSendToAll()
        return
      }
      if (mod && e.key >= '1' && e.key <= '6') {
        e.preventDefault()
        const backend = BACKEND_IDS_IN_UI_ORDER[parseInt(e.key) - 1]
        window.dispatchEvent(
          new CustomEvent('enqueue-single', { detail: { prompt: prompt.trim(), backend } })
        )
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prompt, handleSendToAll])

  // Handle "+ Queue" button requests from QueueColumn
  useEffect(() => {
    const handler = (e: Event): void => {
      const { backend } = (e as CustomEvent).detail
      if (prompt.trim()) {
        window.dispatchEvent(
          new CustomEvent('enqueue-single', { detail: { prompt: prompt.trim(), backend } })
        )
      }
    }
    window.addEventListener('request-enqueue', handler)
    return () => window.removeEventListener('request-enqueue', handler)
  }, [prompt])

  return (
    <div className="prompt-pane">
      <div className="prompt-scroll">
        <div className="prompt-advanced-row">
          <button className="prompt-advanced-btn" onClick={() => setShowAdvanced(true)}>
            Advanced Prompting
          </button>
        </div>
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
              onChange={(e) => saveNotificationField('notifications_enabled', e.target.checked)}
            />
            Notify
          </label>
          <label className="notification-check">
            <input
              type="checkbox"
              checked={soundsEnabled}
              onChange={(e) => saveNotificationField('sounds_enabled', e.target.checked)}
            />
            Sound
          </label>
          <input
            type="range"
            className="notification-volume"
            min={0}
            max={1}
            step={0.05}
            value={localVolume}
            title={`Volume: ${Math.round(localVolume * 100)}%`}
            onChange={(e) => setLocalVolume(parseFloat(e.target.value))}
            onPointerUp={(e) => saveNotificationField('volume', parseFloat((e.target as HTMLInputElement).value))}
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
            <button className="preview-btn preview-btn-neutral" onClick={handleCopyPrompt}>{promptCopied ? '✓ Copied' : 'Copy Prompt'}</button>
            <button className="preview-btn preview-btn-neutral" onClick={handleReveal}>Reveal</button>
            <button className="preview-btn preview-btn-neutral" onClick={handleCopyImage}>{imageCopied ? '✓ Copied' : 'Copy to Clipboard'}</button>
            <button className="preview-btn preview-btn-export" onClick={handleExport}>{exported ? '✓ Exported' : 'Export'}</button>
            <button className="preview-btn preview-btn-export" onClick={handleSaveAs}>Save As…</button>
          </div>
        )}
      </div>

      {showAdvanced && (
        <AdvancedPromptingModal
          initialPrompt={prompt}
          onClose={() => setShowAdvanced(false)}
        />
      )}

      {selectedTask && (
        <div ref={detailsRef} className="metadata-section">
          {!detailsOpen ? (
            <button className="metadata-toggle" onClick={() => setDetailsOpen(true)}>
              <span className="metadata-toggle-chevron">▸</span>
              <span className="metadata-toggle-model">{selectedTask.model}</span>
              <span className="metadata-toggle-sep"> · </span>
              <span className="metadata-toggle-prompt">{selectedTask.prompt}</span>
            </button>
          ) : (
            <div className="preview-metadata" onClick={() => setDetailsOpen(false)}>
              <div><strong>model:</strong> {selectedTask.model}</div>
              <div><strong>status:</strong> {selectedTask.status}</div>
              <div><strong>prompt:</strong> {selectedTask.prompt}</div>
              {selectedTask.estimatedCostUsd !== null && (
                <div><strong>cost:</strong> ${selectedTask.estimatedCostUsd.toFixed(2)}</div>
              )}
              {selectedTask.durationMs !== null && (
                <div><strong>time:</strong> {(selectedTask.durationMs / 1000).toFixed(1)}s</div>
              )}
              {(() => {
                const p = selectedTask.params
                const rows: React.ReactNode[] = []
                if (p.width != null && p.height != null) {
                  rows.push(<div key="size"><strong>size:</strong> {String(p.width)}×{String(p.height)}</div>)
                }
                const skip = new Set(['width', 'height'])
                const labelMap: Record<string, string> = { outputFormat: 'format', negativePrompt: 'negative', personGeneration: 'persons', aspectRatio: 'aspect', imageSize: 'imgSize' }
                for (const [k, v] of Object.entries(p)) {
                  if (skip.has(k) || v == null || v === '') continue
                  rows.push(<div key={k}><strong>{labelMap[k] ?? k}:</strong> {String(v)}</div>)
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
