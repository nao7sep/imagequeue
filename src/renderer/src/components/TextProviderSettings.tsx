import { useEffect, useRef, useState } from 'react'
import { AI_ROLES, TEXT_PROVIDERS, PROVIDER_ENDPOINTS, SUPPORTED_MODELS } from '../../../shared/ai-models'
import { modelPickerGroups, type ModelLists } from '../../../shared/model-lists'
import type { SecretId, TextAIBackendId } from '../../../shared/types'
import { useI18n } from '../i18n/I18nContext'
import { serializeError } from '../../../shared/serialize-error'

export function TextProviderSettings({ config, onChange, keyField }: {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  keyField: (id: SecretId) => React.JSX.Element
}): React.JSX.Element {
  const { t } = useI18n()
  const [lists, setLists] = useState<ModelLists>({})
  const [busy, setBusy] = useState<Partial<Record<TextAIBackendId, boolean>>>({})
  const refreshing = useRef(new Set<TextAIBackendId>())
  const mounted = useRef(false)
  const textAi = (config.text_ai ?? {}) as Record<string, Record<string, unknown>>
  const extras = (config.extraModelIds ?? {}) as Partial<Record<TextAIBackendId, string[]>>

  const logFailure = (error: unknown): void => {
    void window.electronAPI.appLog?.('warn', 'Text model list unavailable', { error: serializeError(error) })
      .catch((logError) => console.error('Could not record model list diagnostic', logError))
  }
  useEffect(() => {
    mounted.current = true
    let active = true
    void window.electronAPI.getTextModelLists().then((value) => {
      if (active) setLists(value)
    }).catch(logFailure)
    return () => { active = false; mounted.current = false }
  }, [])

  const refresh = async (provider: TextAIBackendId): Promise<void> => {
    if (refreshing.current.has(provider)) return
    refreshing.current.add(provider)
    setBusy((value) => ({ ...value, [provider]: true }))
    try {
      const value = await window.electronAPI.refreshTextModelList(provider)
      if (mounted.current) setLists(value)
    } catch (error) { logFailure(error) } finally {
      refreshing.current.delete(provider)
      if (mounted.current) setBusy((value) => ({ ...value, [provider]: false }))
    }
  }

  const updateProvider = (provider: TextAIBackendId, field: string, value: string): void => {
    onChange({ ...config, [provider]: { ...config[provider] as Record<string, unknown>, [field]: value } })
  }
  return <div className="settings-section">
    <div className="settings-field">
      <label htmlFor="text-provider">{t('settings.textAiBackend')}</label>
      <select id="text-provider" value={config.provider as string} onChange={(event) => onChange({ ...config, provider: event.target.value })}>
        <option value="gemini">Gemini</option><option value="openai">OpenAI</option>
      </select>
    </div>
    {TEXT_PROVIDERS.map((provider) => {
      const section = (config[provider] ?? {}) as Record<string, unknown>
      return <div className="settings-subsection" key={provider}>
        <h4>{provider === 'gemini' ? 'Gemini' : 'OpenAI'}</h4>
        <div className="settings-field">
          <label htmlFor={`${provider}-endpoint`}>{t('settings.endpoint')}</label>
          <input id={`${provider}-endpoint`} type="text" value={section.endpoint as string ?? ''}
            placeholder={PROVIDER_ENDPOINTS[provider]} onChange={(event) => updateProvider(provider, 'endpoint', event.target.value)} />
        </div>
        <div className="settings-field"><label>{t('settings.apiKey')}</label>{keyField(`${provider}.text`)}</div>
        {AI_ROLES.map((role) => {
          const value = section[role.id] as string ?? ''
          const groups = modelPickerGroups(provider, role.kind, lists[provider]?.ids ?? [], extras[provider] ?? [])
          const inList = Object.values(groups).some((ids) => ids.includes(value))
          const modelLabel = (id: string): string => SUPPORTED_MODELS.some((row) => row.provider === provider && row.id === id && row.kinds.includes('text-frontier'))
            ? t('settings.frontierModel', { model: id }) : id
          const label = t(role.id === 'elaboration' ? 'settings.mainModel' : 'settings.lightModel')
          return <div className="settings-field" key={role.id}>
            <label htmlFor={`${provider}-${role.id}`}>{label}</label>
            <div className="settings-model-picker">
              <input id={`${provider}-${role.id}`} type="text" value={value}
                onChange={(event) => updateProvider(provider, role.id, event.target.value)} />
              <select aria-label={t('settings.chooseModel', { role: label })} value={value}
                onChange={(event) => updateProvider(provider, role.id, event.target.value)}>
                {!inList && <optgroup label={t('settings.outOfList')}><option value={value}>{value || t('settings.outOfList')}</option></optgroup>}
                <optgroup label={t('settings.bundledModels')}>{groups.bundled.map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}</optgroup>
                {groups.fetched.length > 0 && <optgroup label={t('settings.providerModels')}>{groups.fetched.map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}</optgroup>}
                {groups.extras.length > 0 && <optgroup label={t('settings.extraModelIds')}>{groups.extras.map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}</optgroup>}
              </select>
            </div>
          </div>
        })}
        <div className="settings-field">
          <button type="button" className="modal-btn" disabled={busy[provider]} onClick={() => void refresh(provider)}>{t('settings.refreshModels')}</button>
        </div>
        <div className="settings-field">
          <label htmlFor={`${provider}-extras`}>{t('settings.extraModelIds')}</label>
          <textarea id={`${provider}-extras`} rows={3} value={(extras[provider] ?? []).join('\n')}
            onChange={(event) => onChange({ ...config, extraModelIds: { ...extras,
              [provider]: event.target.value.split('\n'),
            } })} />
          <p className="settings-hint">{t('settings.extraModelIdsHint')}</p>
        </div>
        <div className="settings-field">
          <label htmlFor={`${provider}-timeout`}>{t('settings.timeout')}</label>
          <input id={`${provider}-timeout`} type="number" min={1} step={1}
            value={(textAi[provider]?.timeout_ms as number ?? (provider === 'gemini' ? 30000 : 60000)) / 1000}
            onChange={(event) => onChange({ ...config, text_ai: { ...textAi, [provider]: {
              ...textAi[provider], timeout_ms: (parseInt(event.target.value) || 1) * 1000,
            } } })} />
        </div>
      </div>
    })}
  </div>
}
