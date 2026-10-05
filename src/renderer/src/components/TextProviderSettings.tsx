import { Fragment } from 'react'
import { AI_ROLES, TEXT_PROVIDERS, hasThinkingChoice, textRowFor, thinkingFor } from '../../../shared/ai-models'
import type { SecretId, TextAIBackendId } from '../../../shared/types'
import { useI18n } from '../i18n/I18nContext'

const PROVIDER_NAMES: Record<TextAIBackendId, string> = { gemini: 'Gemini', openai: 'OpenAI' }

export function TextProviderSettings({ config, onChange, keyField }: {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  keyField: (id: SecretId) => React.JSX.Element
}): React.JSX.Element {
  const { t } = useI18n()
  const updateProvider = (provider: TextAIBackendId, field: string, value: unknown): void => {
    onChange({ ...config, [provider]: { ...config[provider] as Record<string, unknown>, [field]: value } })
  }
  return <div className="settings-section">
    <div className="settings-field">
      <label htmlFor="text-provider">{t('settings.textAiBackend')}</label>
      <select id="text-provider" value={config.provider as string} onChange={(event) => onChange({ ...config, provider: event.target.value })}>
        {TEXT_PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_NAMES[provider]}</option>)}
      </select>
    </div>
    {TEXT_PROVIDERS.map((provider) => {
      const section = (config[provider] ?? {}) as Record<string, unknown>
      return <div className="settings-subsection" key={provider}>
        <h4>{PROVIDER_NAMES[provider]}</h4>
        <div className="settings-field">
          <label htmlFor={`${provider}-endpoint`}>{t('settings.endpoint')}</label>
          <input id={`${provider}-endpoint`} type="text" value={section.endpoint as string}
            onChange={(event) => updateProvider(provider, 'endpoint', event.target.value)} />
          <p className="settings-hint">{t('settings.endpointHelp', { provider: PROVIDER_NAMES[provider] })}</p>
        </div>
        <div className="settings-field"><label>{t('settings.apiKey')}</label>{keyField(`${provider}.text`)}</div>
        {AI_ROLES.map((role) => {
          const value = section[role.id] as string
          const thinking = section.thinking as Record<string, string>
          const row = textRowFor(provider, value)
          // A model change resets the role's thinking to the new model's default.
          const changeModel = (id: string): void => {
            const next = textRowFor(provider, id)
            onChange({ ...config, [provider]: { ...section, [role.id]: id,
              thinking: { ...thinking, [role.id]: next ? next.defaultThinking : '' } } })
          }
          return <Fragment key={role.id}>
            <div className="settings-field">
              <label htmlFor={`${provider}-${role.id}`}>{t(`settings.${role.id}Model`)}</label>
              <input id={`${provider}-${role.id}`} type="text" value={value} onChange={(event) => changeModel(event.target.value)} />
              <p className="settings-hint">{t(`settings.${role.id}ModelHelp`)}</p>
              {!row && <p className="settings-hint settings-hint-warning">{t('settings.unsupportedModel')}</p>}
            </div>
            {hasThinkingChoice(row) && <div className="settings-field">
              <label htmlFor={`${provider}-${role.id}-thinking`}>{t('settings.thinking')}</label>
              <select id={`${provider}-${role.id}-thinking`} value={thinkingFor(row, thinking[role.id])}
                onChange={(event) => updateProvider(provider, 'thinking', { ...thinking, [role.id]: event.target.value })}>
                {row.thinking.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
              <p className="settings-hint">{t('settings.thinkingHelp')}</p>
            </div>}
          </Fragment>
        })}
        <div className="settings-field">
          <label htmlFor={`${provider}-timeout`}>{t('settings.timeout')}</label>
          <input id={`${provider}-timeout`} type="number" min={1} step={1}
            value={(section.timeout_ms as number) / 1000}
            onChange={(event) => updateProvider(provider, 'timeout_ms', (parseInt(event.target.value) || 1) * 1000)} />
        </div>
      </div>
    })}
  </div>
}
