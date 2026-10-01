import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { singleLine, multiline } from '../../../shared/textCleanup'
import { presentFailure } from '../utils/failurePresentation'
import {
  PROMPT_FORMATS,
  PROMPT_LENGTHS,
  PROMPT_FORMAT_LABELS,
  PROMPT_LENGTH_LABELS,
  type PromptFormat,
  type PromptLength,
  type FormatDirectives,
} from '../../../shared/session-draft'
import './ElaborationSettingsModal.css'
import { useI18n } from '../i18n/I18nContext'
import { message as msg, type Message } from '../../../shared/i18n/translate'

interface Props {
  onClose: () => void
}

interface BrainstormForm {
  batch_size: number
  concurrency: number
  max_retries_per_turn: number
  retry_backoff_ms_csv: string
  prefer_new_concepts: boolean
  templates: {
    expansion: string
  }
  format_directives: FormatDirectives
}

interface BrainstormConfig {
  batch_size: number
  concurrency: number
  max_retries_per_turn: number
  retry_backoff_ms: number[]
  prefer_new_concepts: boolean
  templates: BrainstormForm['templates']
  format_directives: FormatDirectives
}

function cloneDirectives(d: FormatDirectives): FormatDirectives {
  return { formats: { ...d.formats }, lengths: { ...d.lengths } }
}

// Single-line cleanup for every format/length directive — these are scalar
// sentences, so flatten any pasted line break and trim, keeping interior
// horizontal spacing. Applied at the Save commit point.
function cleanDirectives(d: FormatDirectives): FormatDirectives {
  const mapValues = <K extends string>(rec: Record<K, string>): Record<K, string> =>
    Object.fromEntries(
      (Object.entries(rec) as [K, string][]).map(([k, v]) => [k, singleLine(v)])
    ) as Record<K, string>
  return { formats: mapValues(d.formats), lengths: mapValues(d.lengths) }
}

function fromConfig(cfg: BrainstormConfig): BrainstormForm {
  return {
    batch_size: cfg.batch_size,
    concurrency: cfg.concurrency,
    max_retries_per_turn: cfg.max_retries_per_turn,
    retry_backoff_ms_csv: cfg.retry_backoff_ms.join(', '),
    prefer_new_concepts: cfg.prefer_new_concepts,
    templates: { ...cfg.templates },
    format_directives: cloneDirectives(cfg.format_directives),
  }
}

// Validation results are messages, worded where they are shown.
function parseBackoffCsv(csv: string): { ok: true; value: number[] } | { ok: false; error: Message } {
  const parts = csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length === 0) return { ok: false, error: msg('elabSettings.backoffNone') }
  if (parts.length > 8) return { ok: false, error: msg('elabSettings.backoffTooMany', { max: 8 }) }
  const numbers: number[] = []
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: msg('elabSettings.backoffNotInteger', { value: part }) }
    if (n < 100 || n > 60000) return { ok: false, error: msg('elabSettings.backoffRange', { min: 100, max: 60000, value: n }) }
    numbers.push(n)
  }
  return { ok: true, value: numbers }
}

function checkPlaceholders(form: BrainstormForm): Message | null {
  const t = form.templates
  for (const tag of ['{{ELABORATOR}}', '{{SEED}}', '{{CONCEPTS}}', '{{FORMAT}}', '{{N}}'] as const) {
    if (!t.expansion.includes(tag)) return msg('elabSettings.missingTag', { tag })
  }
  return null
}

function checkFormatDirectives(form: BrainstormForm): Message | null {
  for (const format of PROMPT_FORMATS) {
    if (!form.format_directives.formats[format].trim()) {
      return msg('elabSettings.formatPartEmpty', { part: msg(PROMPT_FORMAT_LABELS[format]) })
    }
  }
  for (const length of PROMPT_LENGTHS) {
    if (!form.format_directives.lengths[length].trim()) {
      return msg('elabSettings.lengthPartEmpty', { part: msg(PROMPT_LENGTH_LABELS[length]) })
    }
  }
  return null
}

function setFormatPart(form: BrainstormForm, format: PromptFormat, value: string): BrainstormForm {
  return {
    ...form,
    format_directives: {
      ...form.format_directives,
      formats: { ...form.format_directives.formats, [format]: value },
    },
  }
}

function setLengthPart(form: BrainstormForm, length: PromptLength, value: string): BrainstormForm {
  return {
    ...form,
    format_directives: {
      ...form.format_directives,
      lengths: { ...form.format_directives.lengths, [length]: value },
    },
  }
}

export function ElaborationSettingsModal({ onClose }: Props): React.JSX.Element {
  const { settings, saveBrainstormSettings } = useSettings()
  const confirm = useConfirm()
  const { t, text, rich } = useI18n()
  const [form, setForm] = useState<BrainstormForm | null>(null)
  const [baseForm, setBaseForm] = useState<BrainstormForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  // Initialize the form from settings.brainstorm. Only run once per modal
  // open; the user's edits live in form state until Save.
  useEffect(() => {
    if (!settings || form) return
    const bs = settings.brainstorm as BrainstormConfig | undefined
    if (!bs) return
    const next = fromConfig(bs)
    setForm(next)
    setBaseForm(fromConfig(bs))
  }, [settings, form])

  const dirty = useMemo(() => {
    if (!form || !baseForm) return false
    return JSON.stringify(form) !== JSON.stringify(baseForm)
  }, [form, baseForm])

  const handleReset = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: t('elabSettings.resetTitle'),
      message: t('elabSettings.resetMessage'),
      confirmLabel: t('settings.reset'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setMessage(null)
    try {
      const defaults = await window.electronAPI.brainstormGetDefaults()
      setForm(fromConfig(defaults))
    } catch (error) {
      setMessage(msg(presentFailure('elaboration-defaults-load', error)))
    } finally {
      setBusy(false)
    }
  }, [confirm, t])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!form) return
    if (form.batch_size < 1 || form.batch_size > 50 || !Number.isInteger(form.batch_size)) {
      setMessage(msg('elabSettings.batchSizeRange', { min: 1, max: 50 }))
      return
    }
    if (form.concurrency < 1 || form.concurrency > 24 || !Number.isInteger(form.concurrency)) {
      setMessage(msg('elabSettings.concurrencyRange', { min: 1, max: 24 }))
      return
    }
    if (form.max_retries_per_turn < 0 || form.max_retries_per_turn > 10 || !Number.isInteger(form.max_retries_per_turn)) {
      setMessage(msg('elabSettings.retriesRange', { min: 0, max: 10 }))
      return
    }
    const backoff = parseBackoffCsv(form.retry_backoff_ms_csv)
    if (!backoff.ok) {
      setMessage(backoff.error)
      return
    }
    const warn = checkPlaceholders(form) ?? checkFormatDirectives(form)
    if (warn) {
      const ok = await confirm({
        title: t('elabSettings.saveAnywayTitle'),
        message: t('elabSettings.saveAnywayMessage', { warning: warn }),
        confirmLabel: t('common.save'),
      })
      if (!ok) return
    }

    setBusy(true)
    setMessage(null)
    try {
      // Clean at this commit point: templates are multiline bodies (tidy
      // edges/trailing whitespace, keep interior structure); format and length
      // directives are scalar sentences (single-line — flatten pasted line
      // breaks, keep horizontal spacing).
      const next = {
        batch_size: form.batch_size,
        concurrency: form.concurrency,
        max_retries_per_turn: form.max_retries_per_turn,
        retry_backoff_ms: backoff.value,
        prefer_new_concepts: form.prefer_new_concepts,
        templates: {
          expansion: multiline(form.templates.expansion),
        },
        format_directives: cleanDirectives(form.format_directives),
      }
      // Main logs `Config saved` whenever the config file is rewritten, so
      // there's nothing extra to record from the renderer side here.
      await saveBrainstormSettings(next)
      onClose()
    } catch (error) {
      setMessage(msg(presentFailure('elaboration-save', error)))
    } finally {
      setBusy(false)
    }
  }, [form, saveBrainstormSettings, onClose, confirm, t])

  const handleCancel = useCallback(async (): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: t('elabSettings.discardTitle'),
        message: t('elabSettings.discardMessage'),
        confirmLabel: t('settings.discard'),
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, confirm, onClose, t])

  if (!form) {
    return (
      <Modal
        title={t('elabSettings.title')}
        className="elaboration-settings-modal-box"
        onClose={onClose}
        footer={
          <button className="modal-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        }
      >
        <div className="elaboration-settings-body">
          <div className="elaboration-settings-empty">{t('common.loading')}</div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title={t('elabSettings.title')}
      className="elaboration-settings-modal-box"
      onClose={handleCancel}
      footer={
        <>
          <button className="modal-btn" onClick={handleCancel} disabled={busy}>{t('common.cancel')}</button>
          <button className="modal-btn modal-btn-primary" onClick={() => void handleSave()} disabled={busy || !dirty}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="elaboration-settings-body">
        <div className="elaboration-settings-section">
          <div className="elaboration-settings-row">
            <label>{t('elabSettings.batchSize')}</label>
            <input
              type="number"
              min={1}
              max={50}
              value={form.batch_size}
              onChange={(e) => setForm({ ...form, batch_size: parseInt(e.target.value) || 1 })}
            />
            <span className="elaboration-settings-hint">{t('elabSettings.batchSizeHint', { min: 1, max: 50 })}</span>
          </div>
          <div className="elaboration-settings-row">
            <label>{t('settings.concurrency')}</label>
            <input
              type="number"
              min={1}
              max={24}
              value={form.concurrency}
              onChange={(e) => setForm({ ...form, concurrency: parseInt(e.target.value) || 1 })}
            />
            <span className="elaboration-settings-hint">{t('elabSettings.concurrencyHint', { min: 1, max: 24 })}</span>
          </div>
          <div className="elaboration-settings-row">
            <label>{t('elabSettings.maxRetries')}</label>
            <input
              type="number"
              min={0}
              max={10}
              value={form.max_retries_per_turn}
              onChange={(e) => setForm({ ...form, max_retries_per_turn: parseInt(e.target.value) || 0 })}
            />
            <span className="elaboration-settings-hint">{t('elabSettings.maxRetriesHint', { min: 0, max: 10 })}</span>
          </div>
          <div className="elaboration-settings-row">
            <label>{t('elabSettings.backoff')}</label>
            <input
              type="text"
              value={form.retry_backoff_ms_csv}
              onChange={(e) => setForm({ ...form, retry_backoff_ms_csv: e.target.value })}
              placeholder="1000, 2000, 4000"
            />
            <span className="elaboration-settings-hint">{t('elabSettings.backoffHint')}</span>
          </div>
          <div className="elaboration-settings-row">
            <label>{t('elabSettings.preferNew')}</label>
            <input
              type="checkbox"
              checked={form.prefer_new_concepts}
              onChange={(e) => setForm({ ...form, prefer_new_concepts: e.target.checked })}
            />
            <span className="elaboration-settings-hint">{t('elabSettings.preferNewHint')}</span>
          </div>
        </div>

        <div className="elaboration-settings-section">
          <div className="elaboration-settings-section-title">{t('elabSettings.templates')}</div>
          <p className="elaboration-settings-help">
            {t('elabSettings.templatesHelp', {
              elaborator: '{{ELABORATOR}}',
              seed: '{{SEED}}',
              concepts: '{{CONCEPTS}}',
              format: '{{FORMAT}}',
              n: '{{N}}',
              json: '{{JSON}}',
            })}
          </p>

          <label className="elaboration-settings-template">
            <span>{t('elabSettings.expansion')}</span>
            <span className="elaboration-settings-tags">{'{{ELABORATOR}} {{SEED}} {{CONCEPTS}} {{FORMAT}} {{N}} {{JSON}}'}</span>
            <textarea
              rows={8}
              value={form.templates.expansion}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, expansion: e.target.value } })}
            />
          </label>
        </div>

        <div className="elaboration-settings-section">
          <div className="elaboration-settings-section-title">{t('elabSettings.formatDirectives')}</div>
          <p className="elaboration-settings-help">
            {rich('elabSettings.formatDirectivesHelp', { tag: <code>{'{{FORMAT}}'}</code> })}
          </p>
          {PROMPT_FORMATS.map((format) => (
            <label className="elaboration-settings-template" key={`format-${format}`}>
              <span>{t('elabSettings.formatPart', { part: t(PROMPT_FORMAT_LABELS[format]) })}</span>
              <textarea
                rows={3}
                value={form.format_directives.formats[format]}
                onChange={(e) => setForm(setFormatPart(form, format, e.target.value))}
              />
            </label>
          ))}
          {PROMPT_LENGTHS.map((length) => (
            <label className="elaboration-settings-template" key={`length-${length}`}>
              <span>{t('elabSettings.lengthPart', { part: t(PROMPT_LENGTH_LABELS[length]) })}</span>
              <textarea
                rows={3}
                value={form.format_directives.lengths[length]}
                onChange={(e) => setForm(setLengthPart(form, length, e.target.value))}
              />
            </label>
          ))}
        </div>

        <div className="elaboration-settings-reset-row">
          <button className="modal-btn modal-btn-danger" onClick={() => void handleReset()} disabled={busy}>
            {t('elabSettings.reset')}
          </button>
        </div>
        {message && <div className="elaboration-settings-message" role="alert">{text(message)}</div>}
      </div>
    </Modal>
  )
}
