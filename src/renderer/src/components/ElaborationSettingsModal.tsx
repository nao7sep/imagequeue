import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useUnsavedDraftReport } from '../hooks/useUnsavedDraftReport'
import { WholeNumberInput, withNumberText, type InvalidNumberText } from './WholeNumberInput'
import { BRAINSTORM_LIMITS, EXPANSION_PLACEHOLDERS, REQUIRED_EXPANSION_PLACEHOLDERS, placeholderTag, type BrainstormConfig } from '../../../shared/brainstorm-config'

interface Props {
  onClose: () => void
}

// The form edits the settings as they are stored.
type BrainstormForm = BrainstormConfig

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
    prefer_new_concepts: cfg.prefer_new_concepts,
    templates: { ...cfg.templates },
    format_directives: cloneDirectives(cfg.format_directives),
  }
}

// Validation results are messages, worded where they are shown.
function checkPlaceholders(form: BrainstormForm): Message | null {
  const t = form.templates
  for (const tag of REQUIRED_EXPANSION_PLACEHOLDERS.map(placeholderTag)) {
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
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const setBusy = useCallback((value: boolean): void => {
    busyRef.current = value
    setBusyState(value)
  }, [])
  const [message, setMessage] = useState<Message | null>(null)
  // A count field holding text that is not a valid value keeps it here, and
  // Save waits until each is corrected.
  const [numberText, setNumberText] = useState<InvalidNumberText>({})
  const numbersValid = Object.keys(numberText).length === 0

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
  useUnsavedDraftReport('elaborationSettings', dirty)

  const handleReset = useCallback(async (): Promise<void> => {
    if (busyRef.current) return
    setBusy(true)
    try {
      const ok = await confirm({
        title: t('elabSettings.resetTitle'),
        message: t('elabSettings.resetMessage'),
        confirmLabel: t('settings.reset'),
        danger: true,
      })
      if (!ok) return
      setMessage(null)
      const defaults = await window.electronAPI.brainstormGetDefaults()
      setForm(fromConfig(defaults))
      setNumberText({})
    } catch (error) {
      setMessage(msg(presentFailure('elaboration-defaults-load', error)))
    } finally {
      setBusy(false)
    }
  }, [confirm, t, setBusy])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!form || !numbersValid || busyRef.current) return
    setBusy(true)
    try {
      const warn = checkPlaceholders(form) ?? checkFormatDirectives(form)
      if (warn) {
        const ok = await confirm({
          title: t('elabSettings.saveAnywayTitle'),
          message: t('elabSettings.saveAnywayMessage', { warning: warn }),
          confirmLabel: t('common.save'),
        })
        if (!ok) return
      }
      setMessage(null)
      // Clean at this commit point: templates are multiline bodies (tidy
      // edges/trailing whitespace, keep interior structure); format and length
      // directives are scalar sentences (single-line — flatten pasted line
      // breaks, keep horizontal spacing).
      const next: BrainstormConfig = {
        batch_size: form.batch_size,
        concurrency: form.concurrency,
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
  }, [form, numbersValid, saveBrainstormSettings, onClose, confirm, t, setBusy])

  const handleCancel = useCallback(async (): Promise<void> => {
    if (busyRef.current) return
    setBusy(true)
    try {
      if (dirty) {
        const ok = await confirm({
          title: t('elabSettings.discardTitle'),
          message: t('elabSettings.discardMessage'),
          confirmLabel: t('settings.discard'),
          cancelLabel: t('settings.keepEditing'),
          danger: true,
        })
        if (!ok) return
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }, [dirty, confirm, onClose, t, setBusy])

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
      dismissable={!busy}
      footer={
        <>
          <button className="modal-btn" onClick={handleCancel} disabled={busy}>{t('common.cancel')}</button>
          <button className="modal-btn modal-btn-primary" onClick={() => void handleSave()} disabled={busy || !dirty || !numbersValid}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="elaboration-settings-body">
        <div className="elaboration-settings-section elaboration-settings-fields">
          <div className="elaboration-settings-row">
            <label htmlFor="elaboration-batch_size">{t('elabSettings.batchSize')}</label>
            <WholeNumberInput
              id="elaboration-batch_size"
              disabled={busy}
              limits={BRAINSTORM_LIMITS.batch_size}
              value={form.batch_size}
              invalidText={numberText['elaboration-batch_size']}
              onInvalidText={(text) => setNumberText((prev) => withNumberText(prev, 'elaboration-batch_size', text))}
              onValue={(value) => setForm({ ...form, batch_size: value })}
            />
            <span className="elaboration-settings-hint">{t('elabSettings.batchSizeHint', BRAINSTORM_LIMITS.batch_size)}</span>
          </div>
          <div className="elaboration-settings-row">
            <label htmlFor="elaboration-concurrency">{t('settings.concurrency')}</label>
            <WholeNumberInput
              id="elaboration-concurrency"
              disabled={busy}
              limits={BRAINSTORM_LIMITS.concurrency}
              value={form.concurrency}
              invalidText={numberText['elaboration-concurrency']}
              onInvalidText={(text) => setNumberText((prev) => withNumberText(prev, 'elaboration-concurrency', text))}
              onValue={(value) => setForm({ ...form, concurrency: value })}
            />
            <span className="elaboration-settings-hint">{t('elabSettings.concurrencyHint', BRAINSTORM_LIMITS.concurrency)}</span>
          </div>
          <div className="elaboration-settings-row">
            <label>{t('elabSettings.preferNew')}</label>
            <input
              disabled={busy}
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
              elaborator: placeholderTag('ELABORATOR'),
              seed: placeholderTag('SEED'),
              concepts: placeholderTag('CONCEPTS'),
              format: placeholderTag('FORMAT'),
              n: placeholderTag('N'),
              json: placeholderTag('JSON'),
            })}
          </p>

          <label className="elaboration-settings-template">
            <span>{t('elabSettings.expansion')}</span>
            <span className="elaboration-settings-tags">{EXPANSION_PLACEHOLDERS.map(placeholderTag).join(' ')}</span>
            <textarea
              disabled={busy}
              rows={8}
              value={form.templates.expansion}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, expansion: e.target.value } })}
            />
          </label>
        </div>

        <div className="elaboration-settings-section">
          <div className="elaboration-settings-section-title">{t('elabSettings.formatDirectives')}</div>
          <p className="elaboration-settings-help">
            {rich('elabSettings.formatDirectivesHelp', { tag: <code>{placeholderTag('FORMAT')}</code> })}
          </p>
          {PROMPT_FORMATS.map((format) => (
            <label className="elaboration-settings-template" key={`format-${format}`}>
              <span>{t('elabSettings.formatPart', { part: t(PROMPT_FORMAT_LABELS[format]) })}</span>
              <textarea
                disabled={busy}
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
                disabled={busy}
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
