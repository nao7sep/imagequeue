import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { Modal } from './Modal'
import { formatUiDateTime } from '../utils/formatDateTime'
import { GEMINI_TEXT_MODELS, TEXT_AI_BACKEND_OPTIONS, getModelsForBackend } from '../../../shared/models'
import type { FluxModelDef } from '../../../shared/models'
import type { RecommendationStatus } from '../../../shared/types'
import './SettingsModal.css'

interface Props {
  onClose: () => void
}

function cloneSettings(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : null
}

function withNotificationField(config: Record<string, unknown> | null, key: string, value: unknown): Record<string, unknown> | null {
  if (!config) return config
  return {
    ...config,
    notifications: { ...(config.notifications as Record<string, unknown> ?? {}), [key]: value },
  }
}

export function SettingsModal({ onClose }: Props): React.JSX.Element {
  const { settings, saveChangedSettings, saveNotificationField } = useSettings()
  const confirm = useConfirm()
  // Local copy — user edits freely; changes commit to context only on Save
  const [config, setConfig] = useState<Record<string, unknown> | null>(() => cloneSettings(settings))
  const [baseConfig, setBaseConfig] = useState<Record<string, unknown> | null>(() => cloneSettings(settings))
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [settingsVolume, setSettingsVolume] = useState<number>((((settings?.notifications as Record<string, unknown>)?.volume) as number) ?? 0.7)
  useEffect(() => {
    const v = (((settings?.notifications as Record<string, unknown>)?.volume) as number) ?? 0.7
    setSettingsVolume(v)
  }, [settings])
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus | null>(null)
  const [recommendationMessage, setRecommendationMessage] = useState('')
  const [recommendationBusy, setRecommendationBusy] = useState(false)
  useEffect(() => {
    if (config || !settings) return
    const next = cloneSettings(settings)
    setConfig(next)
    setBaseConfig(cloneSettings(settings))
  }, [config, settings])

  const dirty = useMemo(
    () => (config && baseConfig ? JSON.stringify(config) !== JSON.stringify(baseConfig) : false),
    [config, baseConfig]
  )

  const handleSave = async (): Promise<void> => {
    if (!config || !baseConfig) return
    setErrorMessage(null)
    try {
      await saveChangedSettings(baseConfig, config)
      onClose()
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e))
    }
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
  const gemini = (textAi.gemini ?? {}) as Record<string, unknown>
  const openai = (textAi.openai ?? {}) as Record<string, unknown>
  const backends = config.image_backends as Record<string, Record<string, unknown>>
  const prompts = config.prompts as Record<string, string>
  const general = (config.general ?? {}) as Record<string, unknown>
  const notificationCfg = (config.notifications ?? {}) as Record<string, unknown>
  const openAiModels = getModelsForBackend('openai')
  const openAiModelDef = openAiModels.find((model) => model.id === (backends.openai.model as string)) ?? openAiModels[0]
  const fluxModels = getModelsForBackend('flux') as FluxModelDef[]
  const fluxModelDef = fluxModels.find((model) => model.id === (backends.flux.model as string)) ?? fluxModels[0]
  const fluxDefaultParams = backends.flux.default_params as Record<string, unknown>
  const fluxStepsValue = fluxModelDef?.stepsRange && typeof fluxDefaultParams.steps === 'number'
    ? Math.max(fluxModelDef.stepsRange.min, Math.min(fluxModelDef.stepsRange.max, fluxDefaultParams.steps))
    : (fluxModelDef?.stepsRange?.default ?? 50)
  const fluxGuidanceValue = fluxModelDef?.guidanceRange && typeof fluxDefaultParams.guidance === 'number'
    ? Math.max(fluxModelDef.guidanceRange.min, Math.min(fluxModelDef.guidanceRange.max, fluxDefaultParams.guidance))
    : (fluxModelDef?.guidanceRange?.default ?? 5)

  const updateTextAi = (key: string, value: unknown): void => {
    setConfig({ ...config, text_ai: { ...textAi, [key]: value } })
  }

  const updateGemini = (key: string, value: unknown): void => {
    setConfig({ ...config, text_ai: { ...textAi, gemini: { ...gemini, [key]: value } } })
  }

  const updateOpenai = (key: string, value: unknown): void => {
    setConfig({ ...config, text_ai: { ...textAi, openai: { ...openai, [key]: value } } })
  }

  const updateGeneral = (key: string, value: unknown): void => {
    setConfig({ ...config, general: { ...general, [key]: value } })
  }

  // Notification file paths are staged with the rest of Settings.
  const updateNotificationFile = (key: string, value: string): void => {
    setConfig({ ...config, notifications: { ...notificationCfg, [key]: value } })
  }

  // Notification toggles and volume save immediately (bypass staged config).
  const saveNotificationImmediate = useCallback(async (key: string, value: unknown): Promise<void> => {
    await saveNotificationField(key, value)
    // Immediate settings are no longer dirty once the main process accepts them.
    setConfig((prev) => withNotificationField(prev, key, value))
    setBaseConfig((prev) => withNotificationField(prev, key, value))
  }, [saveNotificationField])

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
    return formatUiDateTime(value)
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
                <span className="settings-panel-check-desc">Before removing a task from the queue or marking a completed image as kept.</span>
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
                <span className="settings-panel-check-desc">Move deleted task files and session folders to Trash instead of permanently deleting them.</span>
              </span>
            </label>
            <label className="settings-panel-check">
              <input
                type="checkbox"
                checked={general.drop_empty_sessions as boolean}
                onChange={(e) => updateGeneral('drop_empty_sessions', e.target.checked)}
              />
              <span className="settings-panel-check-copy">
                <span>Drop empty sessions</span>
                <span className="settings-panel-check-desc">Automatically delete the session folder when leaving or quitting if no tasks remain. Honors Delete to Trash.</span>
              </span>
            </label>
          </div>
        </div>
        <div className="settings-field settings-field-full">
          <div className="settings-option-panel">
            <div className="settings-option-title">Power</div>
            <label className="settings-panel-check">
              <input
                type="checkbox"
                checked={(general.keep_awake_during_work as boolean) ?? true}
                onChange={(e) => updateGeneral('keep_awake_during_work', e.target.checked)}
              />
              <span className="settings-panel-check-copy">
                <span>Keep system awake during work</span>
                <span className="settings-panel-check-desc">Prevent the computer from sleeping during long-running work like image generation, model downloads, and prompt elaboration. The display may still turn off.</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Notifications</h3>
        <p className="settings-hint">Alerts and sounds only fire when the app is not focused.</p>
        <div className="settings-field settings-field-full settings-panel-after-hint">
          <div className="settings-option-panel">
            <div className="settings-option-title">Alerts</div>
            <label className="settings-panel-check">
              <input
                type="checkbox"
                checked={(notificationCfg.notifications_enabled as boolean) ?? true}
                onChange={(e) => { void saveNotificationImmediate('notifications_enabled', e.target.checked) }}
              />
              <span className="settings-panel-check-copy">
                <span>Show notifications</span>
                <span className="settings-panel-check-desc">Display a small popup when generation completes or fails.</span>
              </span>
            </label>
            <label className="settings-panel-check">
              <input
                type="checkbox"
                checked={(notificationCfg.sounds_enabled as boolean) ?? true}
                onChange={(e) => { void saveNotificationImmediate('sounds_enabled', e.target.checked) }}
              />
              <span className="settings-panel-check-copy">
                <span>Play sounds</span>
                <span className="settings-panel-check-desc">Play a sound when generation completes or fails.</span>
              </span>
            </label>
          </div>
        </div>
        <div className="settings-field">
          <label>Volume</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settingsVolume}
            onChange={(e) => setSettingsVolume(parseFloat(e.target.value))}
            onPointerUp={(e) => { void saveNotificationImmediate('volume', parseFloat((e.target as HTMLInputElement).value)) }}
          />
        </div>
        <div className="settings-field">
          <label>Success sound</label>
          <div className="settings-browse">
            <input
              type="text"
              placeholder="Leave empty to use built-in chime"
              value={(notificationCfg.success_file as string) ?? ''}
              onChange={(e) => updateNotificationFile('success_file', e.target.value)}
            />
            <button
              type="button"
              className="settings-browse-btn"
              onClick={() => {
                void window.electronAPI.openFileDialog([
                  { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
                ]).then((f) => { if (f) updateNotificationFile('success_file', f) })
              }}
            >Browse</button>
          </div>
        </div>
        <div className="settings-field">
          <label>Failure sound</label>
          <div className="settings-browse">
            <input
              type="text"
              placeholder="Leave empty to use built-in tone"
              value={(notificationCfg.failure_file as string) ?? ''}
              onChange={(e) => updateNotificationFile('failure_file', e.target.value)}
            />
            <button
              type="button"
              className="settings-browse-btn"
              onClick={() => {
                void window.electronAPI.openFileDialog([
                  { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
                ]).then((f) => { if (f) updateNotificationFile('failure_file', f) })
              }}
            >Browse</button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Text AI</h3>
        <div className="settings-field">
          <label>Backend</label>
          <select value={textAi.backend as string} onChange={(e) => updateTextAi('backend', e.target.value)}>
            {TEXT_AI_BACKEND_OPTIONS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-subsection">
          <h4>Gemini</h4>
          <div className="settings-field">
            <label>API Key</label>
            <input type="password" value={gemini.api_key as string} onChange={(e) => updateGemini('api_key', e.target.value)} />
          </div>
          <div className="settings-field">
            <label>Light model</label>
            <select value={gemini.light_model as string} onChange={(e) => updateGemini('light_model', e.target.value)}>
              {GEMINI_TEXT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <label>Main model</label>
            <select value={gemini.main_model as string} onChange={(e) => updateGemini('main_model', e.target.value)}>
              {GEMINI_TEXT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <label>Timeout (s)</label>
            <input type="number" min={1} step={1} value={(gemini.timeout_ms as number) / 1000} onChange={(e) => updateGemini('timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
          </div>
        </div>

        <div className="settings-subsection">
          <h4>OpenAI</h4>
          <div className="settings-field">
            <label>Endpoint</label>
            <input type="text" placeholder="https://api.openai.com/v1" value={openai.endpoint as string} onChange={(e) => updateOpenai('endpoint', e.target.value)} />
            <p className="settings-hint">Leave empty for the official OpenAI endpoint.</p>
          </div>
          <div className="settings-field">
            <label>API Key</label>
            <input type="password" value={openai.api_key as string} onChange={(e) => updateOpenai('api_key', e.target.value)} />
          </div>
          <div className="settings-field">
            <label>Light model</label>
            <input type="text" value={openai.light_model as string} onChange={(e) => updateOpenai('light_model', e.target.value)} />
          </div>
          <div className="settings-field">
            <label>Main model</label>
            <input type="text" value={openai.main_model as string} onChange={(e) => updateOpenai('main_model', e.target.value)} />
          </div>
          <div className="settings-field">
            <label>Timeout (s)</label>
            <input type="number" min={1} step={1} value={(openai.timeout_ms as number) / 1000} onChange={(e) => updateOpenai('timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
          </div>
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
          <label>Moderation</label>
          <select value={(backends.openai.default_params as Record<string, unknown>).moderation as string} onChange={(e) => updateBackendParam('openai', 'moderation', e.target.value)}>
            {openAiModelDef.moderations.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>Quality</label>
          <select value={(backends.openai.default_params as Record<string, unknown>).quality as string} onChange={(e) => updateBackendParam('openai', 'quality', e.target.value)}>
            {openAiModelDef.qualities.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
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
            {fluxModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        {fluxModelDef?.stepsRange && (
          <div className="settings-field">
            <label>Steps</label>
            <input
              type="number"
              min={fluxModelDef.stepsRange.min}
              max={fluxModelDef.stepsRange.max}
              value={fluxStepsValue}
              onChange={(e) => {
                const next = parseInt(e.target.value) || fluxModelDef.stepsRange!.default
                updateBackendParam('flux', 'steps', Math.max(fluxModelDef.stepsRange!.min, Math.min(fluxModelDef.stepsRange!.max, next)))
              }}
            />
          </div>
        )}
        {fluxModelDef?.guidanceRange && (
          <div className="settings-field">
            <label>Guidance</label>
            <input
              type="number"
              min={fluxModelDef.guidanceRange.min}
              max={fluxModelDef.guidanceRange.max}
              step={0.5}
              value={fluxGuidanceValue}
              onChange={(e) => {
                const next = parseFloat(e.target.value) || fluxModelDef.guidanceRange!.default
                updateBackendParam('flux', 'guidance', Math.max(fluxModelDef.guidanceRange!.min, Math.min(fluxModelDef.guidanceRange!.max, next)))
              }}
            />
          </div>
        )}
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
          <textarea rows={5} value={prompts.slug} onChange={(e) => setConfig({ ...config, prompts: { ...prompts, slug: e.target.value } })} />
        </div>
        <div className="settings-field-reset">
          <button
            type="button"
            className="modal-btn modal-btn-danger"
            onClick={async () => {
              const ok = await confirm({
                title: 'Reset slug template',
                message: 'Replace the slug template with the shipped default? Your current text will be lost.',
                confirmLabel: 'Reset',
                danger: true,
              })
              if (!ok) return
              const def = await window.electronAPI.promptsGetDefaultSlug()
              setConfig({ ...config, prompts: { ...prompts, slug: def } })
            }}
          >
            Reset to Default
          </button>
        </div>
      </div>

      </div>

      <div className="settings-footer">
        {errorMessage && <span className="settings-status settings-error">{errorMessage}</span>}
        <button className="modal-btn" onClick={() => void handleClose()}>Cancel</button>
        <button className="modal-btn modal-btn-primary" onClick={handleSave} disabled={!dirty}>Save</button>
      </div>
    </Modal>
  )
}
