import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { Modal } from './Modal'
import { useTablist } from '../hooks/useTablist'
import { multiline } from '../../../shared/textCleanup'
import { TextProviderSettings } from './TextProviderSettings'
import { IMAGE_BACKEND_SECRET, type SecretId } from '../../../shared/types'
import { useUiState } from '../context/UiStateContext'
import { NotificationVolumeSlider } from './NotificationVolumeSlider'
import { presentFailure } from '../utils/failurePresentation'
import { serializeError } from '../../../shared/serialize-error'
import { normalizeThemePreference, type ThemePreference } from '../../../shared/theme'
import { LANGUAGES, normalizeLanguagePreference } from '../../../shared/i18n/languages'
import { CATALOGUES, type MessageKey } from '../../../shared/i18n/catalogues'
import { useI18n } from '../i18n/I18nContext'
import './SettingsModal.css'

interface Props {
  onClose: () => void
}

// The Settings tabs: the six per-backend sections share one Image Backends tab
// (six small same-shaped blocks, one category), the rest map one section per tab.
const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: MessageKey }> = [
  { value: 'system', label: 'settings.themeSystem' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeDark' },
]

const SETTINGS_TABS = ['general', 'notifications', 'textai', 'backends', 'prompts'] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]
const SETTINGS_TAB_LABELS: Record<SettingsTab, MessageKey> = {
  general: 'settings.tab.general',
  notifications: 'settings.tab.notifications',
  textai: 'settings.tab.textAi',
  backends: 'settings.tab.backends',
  prompts: 'settings.tab.prompts',
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
  const { settings, apiKeys, saveChangedSettings, saveApiKeys, saveNotificationField } = useSettings()
  const confirm = useConfirm()
  const { t } = useI18n()
  // Local copy — user edits freely; changes commit to context only on Save
  const [config, setConfig] = useState<Record<string, unknown> | null>(() => cloneSettings(settings))
  const [baseConfig, setBaseConfig] = useState<Record<string, unknown> | null>(() => cloneSettings(settings))
  // API keys stage separately from the config because they are stored separately:
  // config.json cannot hold one. Same edit-then-Save shape, its own diff on save.
  const [keys, setKeys] = useState<Record<string, string>>(() => ({ ...(apiKeys ?? {}) }))
  const [baseKeys, setBaseKeys] = useState<Record<string, string>>(() => ({ ...(apiKeys ?? {}) }))
  const [errorMessage, setErrorMessage] = useState<MessageKey | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const handleBrowseFailure = useCallback((error: unknown): void => {
    setErrorMessage('settings.browseFailed')
    void window.electronAPI.appLog('error', 'Settings picker failed', { error: serializeError(error) })
      .catch((logError) => console.error('Failed to record a settings picker diagnostic', logError))
  }, [])
  const tablist = useTablist<SettingsTab>({
    tabs: SETTINGS_TABS,
    selected: activeTab,
    onSelect: setActiveTab,
    idBase: 'settings',
  })
  // Volume is state, not config: it lives in state.json and is shared with the
  // prompt pane's slider through the one context, so the two never disagree.
  const { uiState, patchUiState } = useUiState()
  useEffect(() => {
    if (config || !settings) return
    const next = cloneSettings(settings)
    setConfig(next)
    setBaseConfig(cloneSettings(settings))
  }, [config, settings])

  // Keys arrive on their own channel and may land after the first render; adopt
  // them once, exactly as the config above is adopted, without discarding edits.
  const keysLoaded = apiKeys !== null
  useEffect(() => {
    if (!apiKeys) return
    setKeys((prev) => (Object.keys(prev).length === 0 ? { ...apiKeys } : prev))
    setBaseKeys((prev) => (Object.keys(prev).length === 0 ? { ...apiKeys } : prev))
  }, [apiKeys])

  // Only the ids whose value the user actually changed; a blank clears that key.
  const changedKeys = useMemo(() => {
    const changes: Record<string, string> = {}
    for (const [id, value] of Object.entries(keys)) {
      if (value !== (baseKeys[id] ?? '')) changes[id] = value
    }
    return changes
  }, [keys, baseKeys])

  const dirty = useMemo(
    () =>
      Object.keys(changedKeys).length > 0 ||
      (config && baseConfig ? JSON.stringify(config) !== JSON.stringify(baseConfig) : false),
    [config, baseConfig, changedKeys]
  )

  const handleSave = async (): Promise<void> => {
    if (!config || !baseConfig) return
    setErrorMessage(null)
    try {
      // Clean the slug template (a multiline body) at this commit point before
      // diffing against base, so the stored and compared value is the tidy one.
      const prompts = config.prompts as Record<string, string>
      const cleaned =
        typeof prompts?.slug === 'string'
          ? { ...config, prompts: { ...prompts, slug: multiline(prompts.slug) } }
          : config
      const extraModelIds = JSON.stringify(cleaned.extraModelIds) === JSON.stringify(baseConfig.extraModelIds)
        ? cleaned.extraModelIds : Object.fromEntries(Object.entries((cleaned.extraModelIds ?? {}) as Record<string, string[]>).map(
        ([provider, ids]) => [provider, [...new Set(ids.map((id) => id.trim()).filter(Boolean))]],
      ))
      await saveChangedSettings(baseConfig, { ...cleaned, extraModelIds })
      // Keys second, and only when changed: this write can add or remove a
      // column, so it is the one that resizes the window.
      if (Object.keys(changedKeys).length > 0) {
        await saveApiKeys(changedKeys)
        setBaseKeys({ ...keys })
      }
      onClose()
    } catch (e) {
      setErrorMessage(presentFailure('settings-save', e))
    }
  }

  const handleClose = useCallback(async (): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: t('settings.unsavedTitle'),
        message: t('settings.unsavedMessage'),
        confirmLabel: t('settings.discard'),
        cancelLabel: t('settings.keepEditing'),
        danger: true
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, confirm, onClose, t])

  if (!config) return (
    <Modal
      title={t('settings.title')}
      className="settings-modal-box"
      onClose={handleClose}
      footer={
        <button className="modal-btn" onClick={() => void handleClose()}>
          {t('common.close')}
        </button>
      }
    >
      <div className="settings-overlay">{t('common.loading')}</div>
    </Modal>
  )

  const backends = config.image_backends as Record<string, Record<string, unknown>>
  const prompts = config.prompts as Record<string, string>
  const general = (config.general ?? {}) as Record<string, unknown>
  const supportsStatusIcon = window.electronAPI.platform === 'darwin' || window.electronAPI.platform === 'win32'
  const statusIconLabel = window.electronAPI.platform === 'darwin'
    ? t('settings.statusIconMenuBar')
    : t('settings.statusIconNotificationArea')
  const notificationCfg = (config.notifications ?? {}) as Record<string, unknown>
  // One editor for every API key, addressed by key id. Blank means "no stored
  // key" — saving it clears the stored value; it never writes an empty string.
  const updateKey = (id: SecretId, value: string): void => {
    setKeys((prev) => ({ ...prev, [id]: value }))
  }
  const keyField = (id: SecretId): React.JSX.Element => (
    <input
      type="password"
      value={keys[id] ?? ''}
      disabled={!keysLoaded}
      onChange={(e) => updateKey(id, e.target.value)}
    />
  )

  const updateGeneral = (key: string, value: unknown): void => {
    setConfig({ ...config, general: { ...general, [key]: value } })
  }

  // Notification file paths are staged with the rest of Settings.
  const updateNotificationFile = (key: string, value: string): void => {
    setConfig({ ...config, notifications: { ...notificationCfg, [key]: value } })
  }

  // Notification toggles save immediately (bypass staged config). Volume is not
  // among them — it is state, and patchUiState persists it on its own channel.
  const saveNotificationImmediate = useCallback(async (key: string, value: unknown): Promise<void> => {
    setErrorMessage(null)
    try {
      await saveNotificationField(key, value)
      // Immediate settings are no longer dirty once the main process accepts them.
      setConfig((prev) => withNotificationField(prev, key, value))
      setBaseConfig((prev) => withNotificationField(prev, key, value))
    } catch (error) {
      setErrorMessage(presentFailure('settings-save', error))
    }
  }, [saveNotificationField])

  // A cloud backend's credentials and transport knobs only. Its model and generation
  // parameters belong to the queue column: that is the live surface, and it autosaves
  // them into these same keys, so editing them here too would put two writers on one
  // value. Draw Things is the exception below — no column autosaves it.
  const updateBackend = (backend: string, key: string, value: unknown): void => {
    setConfig({
      ...config,
      image_backends: {
        ...backends,
        [backend]: { ...backends[backend], [key]: value }
      }
    })
  }

  // Draw Things' fallbacks, used when a local model ships no recommended params.
  // Single-writer: the column's autosave covers cloud backends only.
  const updateBackendParam = (backend: string, key: string, value: unknown): void => {
    const params = backends[backend].default_params as Record<string, unknown>
    updateBackend(backend, 'default_params', { ...params, [key]: value })
  }

  return (
    <Modal
      title={t('settings.title')}
      className="settings-modal-box"
      onClose={handleClose}
      footer={
        <>
          <button className="modal-btn" onClick={() => void handleClose()}>{t('common.cancel')}</button>
          <button className="modal-btn modal-btn-primary" onClick={handleSave} disabled={!dirty}>{t('common.save')}</button>
        </>
      }
    >
      <div className="modal-strip">
      <div className="app-tabs" {...tablist.tablistProps} aria-label={t('settings.sectionsLabel')}>
        {SETTINGS_TABS.map((sectionTab) => (
          <button
            key={sectionTab}
            type="button"
            className={`app-tab${activeTab === sectionTab ? ' app-tab--active' : ''}`}
            {...tablist.getTabProps(sectionTab)}
          >
            {t(SETTINGS_TAB_LABELS[sectionTab])}
          </button>
        ))}
      </div>
      </div>
      <div className="settings-overlay">
      {errorMessage && <div className="settings-error" role="alert">{t(errorMessage)}</div>}
      <div className="app-tabpanel" {...tablist.getPanelProps('general')} hidden={activeTab !== 'general'}>
        <div className="settings-section">
          {/* Each language is listed by its own name, in its own script, so a
              reader of any of them can find it whatever language is showing.
              Applied on Save with the rest of Settings. */}
          <div className="settings-field">
            <label htmlFor="settings-language">{t('settings.language')}</label>
            <select
              id="settings-language"
              value={normalizeLanguagePreference(general.language)}
              onChange={(e) => updateGeneral('language', normalizeLanguagePreference(e.target.value))}
            >
              <option value="system">{t('settings.languageSystem')}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language} lang={language}>
                  {CATALOGUES[language]['language.name'] as string}
                </option>
              ))}
            </select>
            <p className="settings-hint">{t('settings.languageHint')}</p>
          </div>
          {/* A native radio group: one tab stop, arrow keys move and select.
              Applied on Save with the rest of Settings, never on its own. */}
          <div className="settings-field">
            <span className="settings-field-label" id="settings-theme-label">{t('settings.theme')}</span>
            <div className="settings-radio-row" role="radiogroup" aria-labelledby="settings-theme-label">
              {THEME_OPTIONS.map(({ value, label }) => (
                <label key={value} className="settings-radio">
                  <input
                    type="radio"
                    name="settings-theme"
                    value={value}
                    checked={normalizeThemePreference(general.theme) === value}
                    onChange={() => updateGeneral('theme', value)}
                  />
                  {t(label)}
                </label>
              ))}
            </div>
            <p className="settings-hint">{t('settings.themeHint')}</p>
          </div>
          <div className="settings-field">
            <label>{t('settings.uiFont')}</label>
            <input
              type="text"
              placeholder={t('settings.uiFontPlaceholder')}
              value={(general.ui_font_family as string) ?? ''}
              onChange={(e) => updateGeneral('ui_font_family', e.target.value)}
            />
            <p className="settings-hint">{t('settings.uiFontHint')}</p>
          </div>
          <div className="settings-field">
            <label>{t('settings.autoPreview')}</label>
            <input
              type="number"
              min={0}
              step={1}
              value={(general.auto_preview_idle_seconds as number) ?? 30}
              onChange={(e) => updateGeneral('auto_preview_idle_seconds', Math.max(0, parseInt(e.target.value) || 0))}
            />
            <p className="settings-hint">{t('settings.autoPreviewHint')}</p>
          </div>
          <div className="settings-field">
            <label>{t('settings.exportFolder')}</label>
            <div className="settings-browse">
              <input
                type="text"
                placeholder={t('settings.exportFolderPlaceholder')}
                value={(general.export_dir as string) ?? ''}
                onChange={(e) => updateGeneral('export_dir', e.target.value)}
              />
              <button
                type="button"
                className="settings-browse-btn"
                onClick={() => {
                  void window.electronAPI.openDirectoryDialog().then((dir) => {
                    if (dir) updateGeneral('export_dir', dir)
                  }).catch(handleBrowseFailure)
                }}
              >
                {t('settings.browse')}
              </button>
            </div>
            <p className="settings-hint">{t('settings.exportFolderHint')}</p>
          </div>
          <div className="settings-field settings-field-full settings-panel-after-hint">
            <div className="settings-option-panel">
              <div className="settings-option-title">{t('settings.deletion')}</div>
              <label className="settings-panel-check">
                <input
                  type="checkbox"
                  checked={(general.confirm_remove as boolean) ?? false}
                  onChange={(e) => updateGeneral('confirm_remove', e.target.checked)}
                />
                <span className="settings-panel-check-copy">
                  <span>{t('settings.confirmRemove')}</span>
                  <span className="settings-panel-check-desc">{t('settings.confirmRemoveHint')}</span>
                </span>
              </label>
              <label className="settings-panel-check">
                <input
                  type="checkbox"
                  checked={(general.confirm_delete as boolean) ?? false}
                  onChange={(e) => updateGeneral('confirm_delete', e.target.checked)}
                />
                <span className="settings-panel-check-copy">
                  <span>{t('settings.confirmDelete')}</span>
                  <span className="settings-panel-check-desc">{t('settings.confirmDeleteHint')}</span>
                </span>
              </label>
              <label className="settings-panel-check">
                <input
                  type="checkbox"
                  checked={(general.delete_to_trash as boolean) ?? true}
                  onChange={(e) => updateGeneral('delete_to_trash', e.target.checked)}
                />
                <span className="settings-panel-check-copy">
                  <span>{t('settings.deleteToTrash')}</span>
                  <span className="settings-panel-check-desc">{t('settings.deleteToTrashHint')}</span>
                </span>
              </label>
              <label className="settings-panel-check">
                <input
                  type="checkbox"
                  checked={general.drop_empty_sessions as boolean}
                  onChange={(e) => updateGeneral('drop_empty_sessions', e.target.checked)}
                />
                <span className="settings-panel-check-copy">
                  <span>{t('settings.dropEmptySessions')}</span>
                  <span className="settings-panel-check-desc">{t('settings.dropEmptySessionsHint')}</span>
                </span>
              </label>
            </div>
          </div>
          <div className="settings-field settings-field-full">
            <div className="settings-option-panel">
              <div className="settings-option-title">{t('settings.power')}</div>
              <label className="settings-panel-check">
                <input
                  type="checkbox"
                  checked={(general.keep_awake_during_work as boolean) ?? true}
                  onChange={(e) => updateGeneral('keep_awake_during_work', e.target.checked)}
                />
                <span className="settings-panel-check-copy">
                  <span>{t('settings.keepAwake')}</span>
                  <span className="settings-panel-check-desc">{t('settings.keepAwakeHint')}</span>
                </span>
              </label>
            </div>
          </div>
          {supportsStatusIcon && (
            <div className="settings-field settings-field-full">
              <div className="settings-option-panel">
                <div className="settings-option-title">{t('settings.backgroundAccess')}</div>
                <label className="settings-panel-check">
                  <input
                    type="checkbox"
                    checked={(general.show_status_icon as boolean) ?? true}
                    onChange={(e) => updateGeneral('show_status_icon', e.target.checked)}
                  />
                  <span className="settings-panel-check-copy">
                    <span>{statusIconLabel}</span>
                    <span className="settings-panel-check-desc">{t('settings.statusIconHint')}</span>
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="app-tabpanel" {...tablist.getPanelProps('notifications')} hidden={activeTab !== 'notifications'}>
        <div className="settings-section">
          <p className="settings-hint">{t('settings.notificationsHint')}</p>
          <div className="settings-field settings-field-full settings-panel-after-hint">
            <div className="settings-option-panel">
              <div className="settings-option-title">{t('settings.alerts')}</div>
              <label className="settings-panel-check">
                <input
                  type="checkbox"
                  checked={(notificationCfg.notifications_enabled as boolean) ?? true}
                  onChange={(e) => { void saveNotificationImmediate('notifications_enabled', e.target.checked) }}
                />
                <span className="settings-panel-check-copy">
                  <span>{t('settings.showNotifications')}</span>
                  <span className="settings-panel-check-desc">{t('settings.showNotificationsHint')}</span>
                </span>
              </label>
              <label className="settings-panel-check">
                <input
                  type="checkbox"
                  checked={(notificationCfg.sounds_enabled as boolean) ?? true}
                  onChange={(e) => { void saveNotificationImmediate('sounds_enabled', e.target.checked) }}
                />
                <span className="settings-panel-check-copy">
                  <span>{t('settings.playSounds')}</span>
                  <span className="settings-panel-check-desc">{t('settings.playSoundsHint')}</span>
                </span>
              </label>
            </div>
          </div>
          <div className="settings-field">
            <label>{t('settings.volume')}</label>
            <NotificationVolumeSlider
              value={uiState.notificationVolume}
              onCommit={(notificationVolume) => patchUiState({ notificationVolume })}
            />
          </div>
          <div className="settings-field">
            <label>{t('settings.successSound')}</label>
            <div className="settings-browse">
              <input
                type="text"
                placeholder={t('settings.successSoundPlaceholder')}
                value={(notificationCfg.success_file as string) ?? ''}
                onChange={(e) => updateNotificationFile('success_file', e.target.value)}
              />
              <button
                type="button"
                className="settings-browse-btn"
                onClick={() => {
                  void window.electronAPI.openFileDialog([
                    { name: t('settings.audioFilter'), extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
                  ]).then((f) => { if (f) updateNotificationFile('success_file', f) }).catch(handleBrowseFailure)
                }}
              >{t('settings.browse')}</button>
            </div>
          </div>
          <div className="settings-field">
            <label>{t('settings.failureSound')}</label>
            <div className="settings-browse">
              <input
                type="text"
                placeholder={t('settings.failureSoundPlaceholder')}
                value={(notificationCfg.failure_file as string) ?? ''}
                onChange={(e) => updateNotificationFile('failure_file', e.target.value)}
              />
              <button
                type="button"
                className="settings-browse-btn"
                onClick={() => {
                  void window.electronAPI.openFileDialog([
                    { name: t('settings.audioFilter'), extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
                  ]).then((f) => { if (f) updateNotificationFile('failure_file', f) }).catch(handleBrowseFailure)
                }}
              >{t('settings.browse')}</button>
            </div>
          </div>
        </div>
      </div>

      <div className="app-tabpanel" {...tablist.getPanelProps('textai')} hidden={activeTab !== 'textai'}>
        <TextProviderSettings config={config} onChange={setConfig} keyField={keyField} />
      </div>

      <div className="app-tabpanel" {...tablist.getPanelProps('backends')} hidden={activeTab !== 'backends'}>
        <div className="settings-section">
          <h3>GPT Image</h3>
          <div className="settings-field">
            <label>{t('settings.apiKey')}</label>
            {keyField(IMAGE_BACKEND_SECRET.openai)}
          </div>
          <div className="settings-field">
            <label>{t('settings.concurrency')}</label>
            <input type="number" min={1} max={10} value={backends.openai.concurrency as number} onChange={(e) => updateBackend('openai', 'concurrency', parseInt(e.target.value) || 1)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.timeout')}</label>
            <input type="number" min={1} step={1} value={(backends.openai.timeout_ms as number) / 1000} onChange={(e) => updateBackend('openai', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
          </div>
        </div>

        <div className="settings-section">
          <h3>Nano Banana</h3>
          <div className="settings-field">
            <label>{t('settings.geminiApiKey')}</label>
            {keyField(IMAGE_BACKEND_SECRET.nanobanana)}
          </div>
          <div className="settings-field">
            <label>{t('settings.concurrency')}</label>
            <input type="number" min={1} max={10} value={backends.nanobanana.concurrency as number} onChange={(e) => updateBackend('nanobanana', 'concurrency', parseInt(e.target.value) || 3)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.timeout')}</label>
            <input type="number" min={1} step={1} value={(backends.nanobanana.timeout_ms as number) / 1000} onChange={(e) => updateBackend('nanobanana', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
          </div>
        </div>

        <div className="settings-section">
          <h3>Grok Imagine</h3>
          <div className="settings-field">
            <label>{t('settings.apiKey')}</label>
            {keyField(IMAGE_BACKEND_SECRET.grok)}
          </div>
          <div className="settings-field">
            <label>{t('settings.concurrency')}</label>
            <input type="number" min={1} max={10} value={backends.grok.concurrency as number} onChange={(e) => updateBackend('grok', 'concurrency', parseInt(e.target.value) || 3)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.timeout')}</label>
            <input type="number" min={1} step={1} value={(backends.grok.timeout_ms as number) / 1000} onChange={(e) => updateBackend('grok', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
          </div>
        </div>

        <div className="settings-section">
          <h3>FLUX</h3>
          <div className="settings-field">
            <label>{t('settings.apiKey')}</label>
            {keyField(IMAGE_BACKEND_SECRET.flux)}
          </div>
          <div className="settings-field">
            <label>{t('settings.concurrency')}</label>
            <input type="number" min={1} max={24} value={backends.flux.concurrency as number} onChange={(e) => updateBackend('flux', 'concurrency', parseInt(e.target.value) || 3)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.timeout')}</label>
            <input type="number" min={1} step={1} value={(backends.flux.timeout_ms as number) / 1000} onChange={(e) => updateBackend('flux', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
          </div>
        </div>

        {window.electronAPI.platform === 'darwin' && (
        <div className="settings-section">
          <h3>Draw Things</h3>
          <div className="settings-field">
            <label>{t('settings.modelsDirectory')}</label>
            {/* The placeholder names no literal path: the real default lives
                under the app's data directory, which IMAGEQUEUE_DATA_DIR moves. */}
            <input value={backends.drawthings.models_dir as string} onChange={(e) => updateBackend('drawthings', 'models_dir', e.target.value)} placeholder={t('settings.modelsDirectoryPlaceholder')} />
          </div>
          <div className="settings-field">
            <label>{t('settings.timeout')}</label>
            <input type="number" min={1} value={Math.round(((backends.drawthings.timeout_ms as number) ?? 1800000) / 1000)} onChange={(e) => updateBackend('drawthings', 'timeout_ms', (parseInt(e.target.value) || 1) * 1000)} />
            <p className="settings-hint">{t('settings.drawThingsTimeoutHint')}</p>
          </div>
          <div className="settings-field">
            <label>{t('settings.fallbackWidth')}</label>
            <input type="number" min={64} step={64} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_width as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_width', parseInt(e.target.value) || 1024)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.fallbackHeight')}</label>
            <input type="number" min={64} step={64} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_height as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_height', parseInt(e.target.value) || 1024)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.fallbackSteps')}</label>
            <input type="number" min={1} max={50} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_steps as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_steps', parseInt(e.target.value) || 4)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.fallbackGuidance')}</label>
            <input type="number" min={1} max={20} step={0.5} value={(backends.drawthings.default_params as Record<string, unknown>).fallback_guidance as number} onChange={(e) => updateBackendParam('drawthings', 'fallback_guidance', parseFloat(e.target.value) || 1)} />
          </div>
          <div className="settings-field">
            <label>{t('settings.fallbackNegative')}</label>
            <input type="text" value={(backends.drawthings.default_params as Record<string, unknown>).fallback_negative_prompt as string} onChange={(e) => updateBackendParam('drawthings', 'fallback_negative_prompt', e.target.value)} />
          </div>
        </div>
        )}
      </div>

      <div className="app-tabpanel" {...tablist.getPanelProps('prompts')} hidden={activeTab !== 'prompts'}>
        <div className="settings-section">
          <div className="settings-field">
            <label>{t('settings.slugTemplate')}</label>
            <textarea rows={5} value={prompts.slug} onChange={(e) => setConfig({ ...config, prompts: { ...prompts, slug: e.target.value } })} />
          </div>
          <div className="settings-field-reset">
            <button
              type="button"
              className="modal-btn modal-btn-danger"
              onClick={async () => {
                const ok = await confirm({
                  title: t('settings.resetSlug'),
                  message: t('settings.resetSlugMessage'),
                  confirmLabel: t('settings.reset'),
                  danger: true,
                })
                if (!ok) return
                const def = await window.electronAPI.promptsGetDefaultSlug()
                setConfig({ ...config, prompts: { ...prompts, slug: def } })
              }}
            >
              {t('settings.resetSlug')}
            </button>
          </div>
        </div>
      </div>

      </div>
    </Modal>
  )
}
