import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { PROMPT_FORMATS, PROMPT_LENGTHS, type PromptFormat, type PromptLength } from '../../../shared/session-draft'
import './ElaborationSettingsModal.css'

interface Props {
  onClose: () => void
}

// The pieces of the {{FORMAT}} directive — one per format, one per length —
// joined with a single space at call time. Mirrors config.format_directives.
type FormatDirectivesForm = {
  formats: Record<PromptFormat, string>
  lengths: Record<PromptLength, string>
}

const FORMAT_LABELS: Record<PromptFormat, string> = {
  phrases: 'Comma phrases',
  sentences: 'Natural sentences',
}
const LENGTH_LABELS: Record<PromptLength, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
}

interface BrainstormForm {
  batch_size: number
  max_retries_per_turn: number
  retry_backoff_ms_csv: string
  templates: {
    first_no_previous: string
    first_with_previous: string
    continuation: string
  }
  format_directives: FormatDirectivesForm
}

interface BrainstormConfig {
  batch_size: number
  max_retries_per_turn: number
  retry_backoff_ms: number[]
  templates: BrainstormForm['templates']
  format_directives: FormatDirectivesForm
}

function cloneDirectives(d: FormatDirectivesForm): FormatDirectivesForm {
  return { formats: { ...d.formats }, lengths: { ...d.lengths } }
}

function fromConfig(cfg: BrainstormConfig): BrainstormForm {
  return {
    batch_size: cfg.batch_size,
    max_retries_per_turn: cfg.max_retries_per_turn,
    retry_backoff_ms_csv: cfg.retry_backoff_ms.join(', '),
    templates: { ...cfg.templates },
    format_directives: cloneDirectives(cfg.format_directives),
  }
}

function parseBackoffCsv(csv: string): { ok: true; value: number[] } | { ok: false; error: string } {
  const parts = csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length === 0) return { ok: false, error: 'Provide at least one backoff value.' }
  if (parts.length > 8) return { ok: false, error: 'Up to 8 backoff values.' }
  const numbers: number[] = []
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: `"${part}" is not an integer.` }
    if (n < 100 || n > 60000) return { ok: false, error: `Backoff values must be 100–60000 ms (got ${n}).` }
    numbers.push(n)
  }
  return { ok: true, value: numbers }
}

function checkPlaceholders(form: BrainstormForm): string | null {
  const t = form.templates
  if (!t.first_no_previous.includes('{{ELABORATOR}}')) return 'First (no previous): missing {{ELABORATOR}}.'
  if (!t.first_no_previous.includes('{{N}}')) return 'First (no previous): missing {{N}}.'
  if (!t.first_no_previous.includes('{{FORMAT}}')) return 'First (no previous): missing {{FORMAT}}.'
  if (!t.first_with_previous.includes('{{ELABORATOR}}')) return 'First (with previous): missing {{ELABORATOR}}.'
  if (!t.first_with_previous.includes('{{PREVIOUS}}')) return 'First (with previous): missing {{PREVIOUS}}.'
  if (!t.first_with_previous.includes('{{N}}')) return 'First (with previous): missing {{N}}.'
  if (!t.first_with_previous.includes('{{FORMAT}}')) return 'First (with previous): missing {{FORMAT}}.'
  if (!t.continuation.includes('{{N}}')) return 'Continuation: missing {{N}}.'
  if (!t.continuation.includes('{{FORMAT}}')) return 'Continuation: missing {{FORMAT}}.'
  return null
}

function checkFormatDirectives(form: BrainstormForm): string | null {
  for (const format of PROMPT_FORMATS) {
    if (!form.format_directives.formats[format].trim()) {
      return `Format part "${FORMAT_LABELS[format]}" is empty.`
    }
  }
  for (const length of PROMPT_LENGTHS) {
    if (!form.format_directives.lengths[length].trim()) {
      return `Length part "${LENGTH_LABELS[length]}" is empty.`
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
  const [form, setForm] = useState<BrainstormForm | null>(null)
  const [baseForm, setBaseForm] = useState<BrainstormForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

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
      title: 'Reset Elaboration Settings',
      message: 'Replace the current values with the shipped defaults? Templates, format directives, and numeric settings will all be reset. You can still cancel before saving.',
      confirmLabel: 'Reset',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setMessage('')
    try {
      const defaults = await window.electronAPI.brainstormGetDefaults()
      setForm(fromConfig(defaults))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [confirm])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!form) return
    if (form.batch_size < 1 || form.batch_size > 50 || !Number.isInteger(form.batch_size)) {
      setMessage('Batch size must be an integer between 1 and 50.')
      return
    }
    if (form.max_retries_per_turn < 0 || form.max_retries_per_turn > 10 || !Number.isInteger(form.max_retries_per_turn)) {
      setMessage('Max retries must be an integer between 0 and 10.')
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
        title: 'Save anyway?',
        message: `${warn} The brainstorm may not work as expected. Save anyway?`,
        confirmLabel: 'Save',
      })
      if (!ok) return
    }

    setBusy(true)
    setMessage('')
    try {
      const next = {
        batch_size: form.batch_size,
        max_retries_per_turn: form.max_retries_per_turn,
        retry_backoff_ms: backoff.value,
        templates: { ...form.templates },
        format_directives: cloneDirectives(form.format_directives),
      }
      // Main logs `Config saved` whenever the config file is rewritten, so
      // there's nothing extra to record from the renderer side here.
      await saveBrainstormSettings(next)
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [form, saveBrainstormSettings, onClose, confirm])

  const handleCancel = useCallback(async (): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes. Close without saving?',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, confirm, onClose])

  if (!form) {
    return (
      <Modal title="Elaboration Settings" className="elaboration-settings-modal-box" onClose={onClose}>
        <div className="elaboration-settings-body">
          <div className="elaboration-settings-empty">Loading…</div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Elaboration Settings" className="elaboration-settings-modal-box" onClose={handleCancel}>
      <div className="elaboration-settings-body">
        <div className="elaboration-settings-section">
          <div className="elaboration-settings-row">
            <label>Batch size</label>
            <input
              type="number"
              min={1}
              max={50}
              value={form.batch_size}
              onChange={(e) => setForm({ ...form, batch_size: parseInt(e.target.value) || 1 })}
            />
            <span className="elaboration-settings-hint">prompts per conversation turn (1–50)</span>
          </div>
          <div className="elaboration-settings-row">
            <label>Max retries per turn</label>
            <input
              type="number"
              min={0}
              max={10}
              value={form.max_retries_per_turn}
              onChange={(e) => setForm({ ...form, max_retries_per_turn: parseInt(e.target.value) || 0 })}
            />
            <span className="elaboration-settings-hint">extra attempts after a transient failure (0–10)</span>
          </div>
          <div className="elaboration-settings-row">
            <label>Retry backoff (ms)</label>
            <input
              type="text"
              value={form.retry_backoff_ms_csv}
              onChange={(e) => setForm({ ...form, retry_backoff_ms_csv: e.target.value })}
              placeholder="1000, 2000, 4000"
            />
            <span className="elaboration-settings-hint">comma-separated; if there are more retries than values, the last one repeats</span>
          </div>
        </div>

        <div className="elaboration-settings-section">
          <div className="elaboration-settings-section-title">Templates</div>
          <p className="elaboration-settings-help">
            Sent to the AI with placeholders filled in at call time. Keep <code>{'{{FORMAT}}'}</code> and <code>{'{{JSON}}'}</code> in every template; the README explains each placeholder.
          </p>

          <label className="elaboration-settings-template">
            <span>First message — no previous prompts</span>
            <span className="elaboration-settings-tags">{'{{ELABORATOR}} {{SEED}} {{FORMAT}} {{N}} {{JSON}}'}</span>
            <textarea
              rows={5}
              value={form.templates.first_no_previous}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, first_no_previous: e.target.value } })}
            />
          </label>

          <label className="elaboration-settings-template">
            <span>First message — with previous prompts</span>
            <span className="elaboration-settings-tags">{'{{ELABORATOR}} {{SEED}} {{PREVIOUS}} {{FORMAT}} {{N}} {{JSON}}'}</span>
            <textarea
              rows={5}
              value={form.templates.first_with_previous}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, first_with_previous: e.target.value } })}
            />
          </label>

          <label className="elaboration-settings-template">
            <span>Continuation message</span>
            <span className="elaboration-settings-tags">{'{{FORMAT}} {{N}} {{JSON}}'}</span>
            <textarea
              rows={5}
              value={form.templates.continuation}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, continuation: e.target.value } })}
            />
          </label>
        </div>

        <div className="elaboration-settings-section">
          <div className="elaboration-settings-section-title">Format directives</div>
          <p className="elaboration-settings-help">
            <code>{'{{FORMAT}}'}</code> is built from the chosen format part and length part joined with a single space, so write each as a complete sentence. The format and length themselves are picked in Advanced Prompting.
          </p>
          {PROMPT_FORMATS.map((format) => (
            <label className="elaboration-settings-template" key={`format-${format}`}>
              <span>{`Format — ${FORMAT_LABELS[format]}`}</span>
              <textarea
                rows={2}
                value={form.format_directives.formats[format]}
                onChange={(e) => setForm(setFormatPart(form, format, e.target.value))}
              />
            </label>
          ))}
          {PROMPT_LENGTHS.map((length) => (
            <label className="elaboration-settings-template" key={`length-${length}`}>
              <span>{`Length — ${LENGTH_LABELS[length]}`}</span>
              <textarea
                rows={2}
                value={form.format_directives.lengths[length]}
                onChange={(e) => setForm(setLengthPart(form, length, e.target.value))}
              />
            </label>
          ))}
        </div>

        <div className="elaboration-settings-reset-row">
          <button className="modal-btn modal-btn-danger" onClick={() => void handleReset()} disabled={busy}>
            Reset to Defaults
          </button>
        </div>
      </div>
      <div className="elaboration-settings-footer">
        {message && <div className="elaboration-settings-message">{message}</div>}
        <div className="elaboration-settings-footer-actions">
          <button className="modal-btn" onClick={handleCancel} disabled={busy}>Cancel</button>
          <button className="modal-btn modal-btn-primary" onClick={() => void handleSave()} disabled={busy || !dirty}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
