import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { Modal } from './Modal'
import { TEXT_AI_BACKENDS, getTextAIModels, getModelsForBackend } from '../../../shared/models'
import type { RecommendationStatus } from '../../../shared/types'
import './Settings.css'

interface Props {
  onClose: () => void
}

export function Settings({ onClose }: Props): React.JSX.Element {
  const { settings, updateSettings } = useSettings()
  const confirm = useConfirm()
  // Local copy — user edits freely; changes commit to context only on Save
  const [config, setConfig] = useState<Record<string, unknown> | null>(() => settings)
  const [status, setStatus] = useState('')
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus | null>(null)
  const [recommendationMessage, setRecommendationMessage] = useState('')
  const [recommendationBusy, setRecommendationBusy] = useState(false)
  const [originalSnapshot, setOriginalSnapshot] = useState<string>(() => JSON.stringify(settings))

  const dirty = useMemo(
    () => (config ? JSON.stringify(config) !== originalSnapshot : false),
    [config, originalSnapshot]
  )

  const handleSave = async (): Promise<void> => {
    if (!config) return
    await updateSettings(config)
    setOriginalSnapshot(JSON.stringify(config))
    setStatus('Saved')
    setTimeout(() => setStatus(''), 2000)
  }

  const handleClose = useCallback(async (): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: 'Unsaved changes',
        message: 'Close Settings without saving?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep Editing',
        danger: true
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, confirm, onClose])

  const refreshRecommendationStatus = useCallback(async (): Promise<void> => {
    if (window.electronAPI.platform !== 'darwin') return
    const next = await window.electronAPI.getRecommendationsStatus()
    setRecommendationStatus(next)
  }, [])

  useEffect(() => {
    void refreshRecommendationStatus()
  }, [refreshRecommendationStatus])

  if (!config) return (
    <Modal title="Settings" className="settings-modal-box" onClose={handleClose}>
      <div className="settings-overlay">Loading…</div>
    </Modal>
  )

  const textAi = config.text_ai as Record<string, unknown>
  const backends = config.image_backends as Record<string, Record<string, unknown>>
  const prompts = config.prompts as Record<string, string>
  const general = (config.general ?? {}) as Record<string, unknown>

  const updateTextAi = (key: string, value: unknown): void => {
    setConfig({ ...config, text_ai: { ...textAi, [key]: value } })
  }

  const updateGeneral = (key: string, value: unknown): void => {
    setConfig({ ...config, general: { ...general, [key]: value } })
  }

  const updateBackend = (backend: string, key: string, value: unknown): void => {
    setConfig({
      ...config,
      image_backends: {
        ...backends,
        [backend]: { ...backends[backend], [key]: value }
      }
    })
  }

  const updateBackendParam = (backend: string, key: string, value: unknown): void => {
    const params = backends[backend].default_params as Record<string, unknown>
    updateBackend(backend, 'default_params', { ...params, [key]: value })
  }

  const handleDownloadRecommendations = async (): Promise<void> => {
    setRecommendationBusy(true)
    setRecommendationMessage('')
    try {
      const result = await window.electronAPI.downloadRecommendations()
      setRecommendationStatus(result)
      setRecommendationMessage(result.message)
      window.dispatchEvent(new CustomEvent('recommendations-updated'))
    } catch (err) {
      setRecommendationMessage((err as Error).message)
      await refreshRecommendationStatus()
    } finally {
      setRecommendationBusy(false)
    }
  }

  const handleImportRecommendations = async (): Promise<void> => {
    const filePath = await window.electronAPI.openFileDialog([{ name: 'JSON', extensions: ['json'] }])
    if (!filePath) return
    setRecommendationBusy(true)
    setRecommendationMessage('')
    try {
      const result = await window.electronAPI.importRecommendations(filePath)
      setRecommendationStatus(result)
      setRecommendationMessage(result.message)
      window.dispatchEvent(new CustomEvent('recommendations-updated'))
    } catch (err) {
      setRecommendationMessage((err as Error).message)
      await refreshRecommendationStatus()
    } finally {
      setRecommendationBusy(false)
    }
  }

  const formatRecommendationTimestamp = (value: string | null): string => {
    if (!value) return 'n/a'
    return new Date(value).toLocaleString()
  }

  return (
    <Modal title="Settings" className="settings-modal-box" onClose={handleClose}>
      <div className="settings-overlay">
      <div className="settings-section">
        <h3>General</h3>
        <div className="settings-field">
          <label>Auto-preview (s)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={(general.auto_preview_idle_seconds as number) ?? 30}
            onChange={(e) => updateGeneral('auto_preview_idle_seconds', Math.max(0, parseInt(e.target.value) || 0))}
          />
          <p className="settings-hint">Seconds of inactivity before the latest completed image is automatically selected and previewed. Set to 0 to disable.</p>
        </div>
        <div className="settings-field">
          <label>Export folder</label>
          <div className="settings-browse">
            <input
              type="text"
              placeholder="Leave empty to use Desktop"
              value={(general.export_dir as string) ?? ''}
              onChange={(e) => updateGeneral('export_dir', e.target.value)}
            />
            <button
              type="button"
              className="settings-browse-btn"
              onClick={() => {
                void window.electronAPI.openDirectoryDialog().then((dir) => {
                  if (dir) updateGeneral('export_dir', dir)
                })
              }}
            >
              Browse
            </button>
          </div>
          <p className="settings-hint">Where exported images are saved.</p>
        </div>
        <div className="settings-field settings-field-full settings-panel-after-hint">
          <div className="settings-option-panel">
            <div className="settings-option-title">Deletion</div>
            <label className="settings-panel-check">
              <input
                type="checkbox"
                checked={(general.confirm_remove as boolean) ?? false}
                onChange={(e) => updateGeneral('confirm_remove', e.target.checked)}
              />
              <span className="settings-panel-check-copy">
                <span>Confirm remove</span>
                <span className="settings-panel-check-desc">Before removing a task from the queue.</span>
              </span>
            </label>
            <label className="settings-panel-check">
              <input
                type="checkbox"
                checked={(general.confirm_delete as boolean) ?? false}
                onChange={(e) => updateGeneral('confirm_delete', e.target.checked)}
              />
              <span className="settings-panel-check-copy">
                <span>Confirm delete</span>
                <span className="settings-panel-check-desc">Before deleting a task and its files.</span>
              </span>
            </label>
            <label className="settings-panel-check">
              <input
                type="checkbox"
                checked={(general.delete_to_trash as boolean) ?? true}
                onChange={(e) => updateGeneral('delete_to_trash', e.target.checked)}
              />
              <span className="settings-panel-check-copy">
                <span>Delete to Trash</span>
                <span className="settings-panel-check-desc">Move deleted files to Trash instead of permanently deleting them.</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Text AI</h3>
        <div className="settings-field">
          <label>Backend</label>
          <select value={textAi.backend as string} onChange={(e) => updateTextAi('backend', e.target.value)}>
            {TEXT_AI_BACKENDS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={textAi.api_key as string} onChange={(e) => updateTextAi('api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <select value={textAi.model as string} onChange={(e) => updateTextAi('model', e.target.value)}>
            {getTextAIModels(textAi.backend as string).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>Timeout (s)</label>
          <input type="number" min={1} step={1} value={(textAi.timeout_ms as number) / 1000} onChange={(e) => updateTextAi('timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>GPT Image</h3>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={backends.openai.api_key as string} onChange={(e) => updateBackend('openai', 'api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <select value={backends.openai.model as string} onChange={(e) => updateBackend('openai', 'model', e.target.value)}>
            {getModelsForBackend('openai').map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>Quality</label>
          <select value={(backends.openai.default_params as Record<string, unknown>).quality as string} onChange={(e) => updateBackendParam('openai', 'quality', e.target.value)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="auto">auto</option>
          </select>
        </div>
        <div className="settings-field">
          <label>Concurrency</label>
          <input type="number" min={1} max={10} value={backends.openai.concurrency as number} onChange={(e) => updateBackend('openai', 'concurrency', parseInt(e.target.value) || 1)} />
        </div>
        <div className="settings-field">
          <label>Timeout (s)</label>
          <input type="number" min={1} step={1} value={(backends.openai.timeout_ms as number) / 1000} onChange={(e) => updateBackend('openai', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>Google Imagen</h3>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={backends.imagen.api_key as string} onChange={(e) => updateBackend('imagen', 'api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <select value={backends.imagen.model as string} onChange={(e) => updateBackend('imagen', 'model', e.target.value)}>
            {getModelsForBackend('imagen').map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>Concurrency</label>
          <input type="number" min={1} max={10} value={backends.imagen.concurrency as number} onChange={(e) => updateBackend('imagen', 'concurrency', parseInt(e.target.value) || 1)} />
        </div>
        <div className="settings-field">
          <label>Timeout (s)</label>
          <input type="number" min={1} step={1} value={(backends.imagen.timeout_ms as number) / 1000} onChange={(e) => updateBackend('imagen', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>Nano Banana</h3>
        <div className="settings-field">
          <label>Gemini API Key</label>
          <input type="password" value={backends.nanobanana.api_key as string} onChange={(e) => updateBackend('nanobanana', 'api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <select value={backends.nanobanana.model as string} onChange={(e) => updateBackend('nanobanana', 'model', e.target.value)}>
            {getModelsForBackend('nanobanana').map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>Concurrency</label>
          <input type="number" min={1} max={10} value={backends.nanobanana.concurrency as number} onChange={(e) => updateBackend('nanobanana', 'concurrency', parseInt(e.target.value) || 3)} />
        </div>
        <div className="settings-field">
          <label>Timeout (s)</label>
          <input type="number" min={1} step={1} value={(backends.nanobanana.timeout_ms as number) / 1000} onChange={(e) => updateBackend('nanobanana', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>Grok Imagine</h3>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={backends.grok.api_key as string} onChange={(e) => updateBackend('grok', 'api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <select value={backends.grok.model as string} onChange={(e) => updateBackend('grok', 'model', e.target.value)}>
            {getModelsForBackend('grok').map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>Concurrency</label>
          <input type="number" min={1} max={10} value={backends.grok.concurrency as number} onChange={(e) => updateBackend('grok', 'concurrency', parseInt(e.target.value) || 3)} />
        </div>
        <div className="settings-field">
          <label>Timeout (s)</label>
          <input type="number" min={1} step={1} value={(backends.grok.timeout_ms as number) / 1000} onChange={(e) => updateBackend('grok', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>FLUX</h3>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={backends.flux.api_key as string} onChange={(e) => updateBackend('flux', 'api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <select value={backends.flux.model as string} onChange={(e) => updateBackend('flux', 'model', e.target.value)}>
            {getModelsForBackend('flux').map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>Steps</label>
          <input type="number" min={1} max={50} value={(backends.flux.default_params as Record<string, unknown>).steps as number} onChange={(e) => updateBackendParam('flux', 'steps', parseInt(e.target.value) || 28)} />
        </div>
        <div className="settings-field">
          <label>Concurrency</label>
          <input type="number" min={1} max={24} value={backends.flux.concurrency as number} onChange={(e) => updateBackend('flux', 'concurrency', parseInt(e.target.value) || 3)} />
        </div>
        <div className="settings-field">
          <label>Timeout (s)</label>
          <input type="number" min={1} step={1} value={(backends.flux.timeout_ms as number) / 1000} onChange={(e) => updateBackend('flux', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
        </div>
      </div>

      {window.electronAPI.platform === 'darwin' && (
      <div className="settings-section">
        <h3>Draw Things</h3>
        <div className="settings-field">
          <label>CLI Path</label>
          <input value={backends.drawthings.cli_path as string} onChange={(e) => updateBackend('drawthings', 'cli_path', e.target.value)} placeholder="leave empty to use PATH" />
        </div>
        <div className="settings-field">
          <label>Models Directory</label>
          <input value={backends.drawthings.models_dir as string} onChange={(e) => updateBackend('drawthings', 'models_dir', e.target.value)} placeholder="leave empty to use ~/.imagequeue/models" />
        </div>
        <div className="settings-field settings-field-full">
          <div className="recommendation-panel">
            <div className="recommendation-title">Recommendations</div>
            <div className="recommendation-panel-top">
              <div className="recommendation-panel-main">
                {recommendationStatus?.exists ? (
                  recommendationStatus.valid ? (
                    <span>{recommendationStatus.entryCount} entries, updated {formatRecommendationTimestamp(recommendationStatus.updatedAt)}</span>
                  ) : (
                    <span>Found but not readable: {recommendationStatus.error}</span>
                  )
                ) : (
                  <span>No recommendation file found.</span>
                )}
                {recommendationMessage && <span className="recommendation-message">{recommendationMessage}</span>}
              </div>
            </div>
            <div className="recommendation-actions">
              <button type="button" onClick={() => void handleDownloadRecommendations()} disabled={recommendationBusy}>
                Download Latest
              </button>
              <button type="button" onClick={() => void handleImportRecommendations()} disabled={recommendationBusy}>
                Import
              </button>
            </div>
            <label className="recommendation-auto-update">
              <input
                type="checkbox"
                checked={(backends.drawthings.auto_update_recommendations as boolean) ?? false}
                onChange={(e) => updateBackend('drawthings', 'auto_update_recommendations', e.target.checked)}
              />
              Update recommendations at app launch
            </label>
          </div>
        </div>
        <div className="settings-field">
          <label>Fallback Width</label>
          <input type="number" min={64} step={64} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_width as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_width', parseInt(e.target.value) || 1024)} />
        </div>
        <div className="settings-field">
          <label>Fallback Height</label>
          <input type="number" min={64} step={64} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_height as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_height', parseInt(e.target.value) || 1024)} />
        </div>
        <div className="settings-field">
          <label>Fallback Steps</label>
          <input type="number" min={1} max={50} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_steps as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_steps', parseInt(e.target.value) || 4)} />
        </div>
        <div className="settings-field">
          <label>Fallback Guidance</label>
          <input type="number" min={1} max={20} step={0.5} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_guidance as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_guidance', parseFloat(e.target.value) || 1)} />
        </div>
        <div className="settings-field">
          <label>Fallback Negative</label>
          <input type="text" value={(backends.drawthings.default_params as Record<string, unknown>).fallback_negative_prompt as string} onChange={(e) => updateBackendParam('drawthings', 'fallback_negative_prompt', e.target.value)} />
        </div>
      </div>
      )}

      <div className="settings-section">
        <h3>Prompts</h3>
        <div className="settings-field">
          <label>Slug template</label>
          <textarea value={prompts.slug} onChange={(e) => setConfig({ ...config, prompts: { ...prompts, slug: e.target.value } })} />
        </div>
      </div>

      </div>

      <div className="settings-footer">
        {dirty && !status && <span className="settings-status settings-unsaved">Unsaved changes</span>}
        {status && <span className="settings-status">{status}</span>}
        <button className="settings-save" onClick={handleSave}>Save</button>
      </div>
    </Modal>
  )
}
