import { useState, useEffect } from 'react'
import { TEXT_AI_BACKENDS, getTextAIModels, getModelsForBackend } from '../../../shared/models'
import './Settings.css'

interface Props {
  onClose: () => void
}

export function Settings({ onClose }: Props): React.JSX.Element {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.electronAPI.getSettings().then(setConfig)
  }, [])

  const handleSave = async (): Promise<void> => {
    if (!config) return
    await window.electronAPI.saveSettings(config)
    window.dispatchEvent(new CustomEvent('settings-saved'))
    setStatus('Saved')
    setTimeout(() => setStatus(''), 2000)
  }

  if (!config) return <div className="settings-overlay">Loading...</div>

  const textAi = config.text_ai as Record<string, string>
  const backends = config.image_backends as Record<string, Record<string, unknown>>
  const prompts = config.prompts as Record<string, string>

  const updateTextAi = (key: string, value: string): void => {
    setConfig({ ...config, text_ai: { ...textAi, [key]: value } })
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

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="settings-close" onClick={onClose}>✕</button>
      </div>

      <div className="settings-section">
        <h3>Text AI</h3>
        <div className="settings-field">
          <label>Backend</label>
          <select value={textAi.backend} onChange={(e) => updateTextAi('backend', e.target.value)}>
            {TEXT_AI_BACKENDS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={textAi.api_key} onChange={(e) => updateTextAi('api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <select value={textAi.model} onChange={(e) => updateTextAi('model', e.target.value)}>
            {getTextAIModels(textAi.backend).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
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
          </select>
        </div>
        <div className="settings-field">
          <label>Concurrency</label>
          <input type="number" min={1} max={10} value={backends.openai.concurrency as number} onChange={(e) => updateBackend('openai', 'concurrency', parseInt(e.target.value) || 1)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>Imagen</h3>
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
      </div>

      {window.electronAPI.platform !== 'win32' && (
      <div className="settings-section">
        <h3>Draw Things</h3>
        <div className="settings-field">
          <label>CLI Path</label>
          <input value={backends.drawthings.cli_path as string} onChange={(e) => updateBackend('drawthings', 'cli_path', e.target.value)} placeholder="leave empty to use PATH" />
        </div>
        <div className="settings-field">
          <label>Models Directory</label>
          <input value={backends.drawthings.models_dir as string} onChange={(e) => updateBackend('drawthings', 'models_dir', e.target.value)} placeholder="~/.imagequeue/models" />
          <span className="settings-hint">Leave empty to use Draw Things&apos; default location (shared with GUI app)</span>
        </div>
        <div className="settings-field">
          <label>Default Steps</label>
          <input type="number" min={1} max={50} value={(backends.drawthings.default_params as Record<string, unknown>).steps as number} onChange={(e) => updateBackendParam('drawthings', 'steps', parseInt(e.target.value) || 4)} />
        </div>
        <div className="settings-field">
          <label>Default CFG</label>
          <input type="number" min={0} max={20} step={0.5} value={(backends.drawthings.default_params as Record<string, unknown>).cfg as number} onChange={(e) => updateBackendParam('drawthings', 'cfg', parseFloat(e.target.value) || 1)} />
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

      <div className="settings-footer">
        {status && <span className="settings-status">{status}</span>}
        <button className="settings-save" onClick={handleSave}>Save</button>
      </div>
    </div>
  )
}
