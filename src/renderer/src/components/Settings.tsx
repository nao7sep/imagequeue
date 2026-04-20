import { useState, useEffect } from 'react'
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
        <button className="settings-close" onClick={onClose}>✕ Close</button>
      </div>

      <div className="settings-section">
        <h3>Text AI (slug generation)</h3>
        <div className="settings-field">
          <label>Backend</label>
          <select value={textAi.backend} onChange={(e) => updateTextAi('backend', e.target.value)}>
            <option value="google">Google</option>
          </select>
        </div>
        <div className="settings-field">
          <label>Model</label>
          <input value={textAi.model} onChange={(e) => updateTextAi('model', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={textAi.api_key} onChange={(e) => updateTextAi('api_key', e.target.value)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>OpenAI</h3>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={backends.openai.api_key as string} onChange={(e) => updateBackend('openai', 'api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <input value={backends.openai.model as string} onChange={(e) => updateBackend('openai', 'model', e.target.value)} />
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
        <h3>Google</h3>
        <div className="settings-field">
          <label>API Key</label>
          <input type="password" value={backends.google.api_key as string} onChange={(e) => updateBackend('google', 'api_key', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <input value={backends.google.model as string} onChange={(e) => updateBackend('google', 'model', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Concurrency</label>
          <input type="number" min={1} max={10} value={backends.google.concurrency as number} onChange={(e) => updateBackend('google', 'concurrency', parseInt(e.target.value) || 1)} />
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
          <input value={backends.flux.model as string} onChange={(e) => updateBackend('flux', 'model', e.target.value)} />
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

      <div className="settings-section">
        <h3>Local (Draw Things CLI)</h3>
        <div className="settings-field">
          <label>CLI Path</label>
          <input value={backends.local.cli_path as string} onChange={(e) => updateBackend('local', 'cli_path', e.target.value)} placeholder="leave empty to use PATH" />
        </div>
        <div className="settings-field">
          <label>Model</label>
          <input value={backends.local.model as string} onChange={(e) => updateBackend('local', 'model', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Models Dir</label>
          <input value={backends.local.models_dir as string} onChange={(e) => updateBackend('local', 'models_dir', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>Steps</label>
          <input type="number" min={1} max={50} value={(backends.local.default_params as Record<string, unknown>).steps as number} onChange={(e) => updateBackendParam('local', 'steps', parseInt(e.target.value) || 20)} />
        </div>
      </div>

      <div className="settings-section">
        <h3>Prompts</h3>
        <div className="settings-field">
          <label>Slug template</label>
          <textarea value={prompts.slug} onChange={(e) => setConfig({ ...config, prompts: { ...prompts, slug: e.target.value } })} />
        </div>
      </div>

      <button className="settings-save" onClick={handleSave}>Save Settings</button>
      {status && <span className="settings-status">{status}</span>}
    </div>
  )
}
