import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import './ElaborationSettingsModal.css'

interface Props {
  onClose: () => void
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
}

interface BrainstormConfig {
  batch_size: number
  max_retries_per_turn: number
  retry_backoff_ms: number[]
  templates: BrainstormForm['templates']
}

function fromConfig(cfg: BrainstormConfig): BrainstormForm {
  return {
    batch_size: cfg.batch_size,
    max_retries_per_turn: cfg.max_retries_per_turn,
    retry_backoff_ms_csv: cfg.retry_backoff_ms.join(', '),
    templates: { ...cfg.templates },
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
  if (!t.first_with_previous.includes('{{ELABORATOR}}')) return 'First (with previous): missing {{ELABORATOR}}.'
  if (!t.first_with_previous.includes('{{PREVIOUS}}')) return 'First (with previous): missing {{PREVIOUS}}.'
  if (!t.first_with_previous.includes('{{N}}')) return 'First (with previous): missing {{N}}.'
  if (!t.continuation.includes('{{N}}')) return 'Continuation: missing {{N}}.'
  return null
}

export function ElaborationSettingsModal({ onClose }: Props): React.JSX.Element {
  const { settings, updateSettings } = useSettings()
  const confirm = useConfirm()
  const [form, setForm] = useState<BrainstormForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // Initialize the form from settings.brainstorm. Only run once per modal
  // open; the user's edits live in form state until Save.
  useEffect(() => {
    if (!settings) return
    const bs = settings.brainstorm as BrainstormConfig | undefined
    if (!bs) return
    setForm(fromConfig(bs))
  }, [settings])

  const original = useMemo(() => {
    const bs = settings?.brainstorm as BrainstormConfig | undefined
    return bs ? fromConfig(bs) : null
  }, [settings])

  const dirty = useMemo(() => {
    if (!form || !original) return false
    return JSON.stringify(form) !== JSON.stringify(original)
  }, [form, original])

  const handleReset = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Reset Elaboration Settings',
      message: 'Replace the current values with the shipped defaults? Templates and numeric settings will both be reset. You can still cancel before saving.',
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
    if (!form || !settings) return
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
    const placeholderWarn = checkPlaceholders(form)
    if (placeholderWarn) {
      const ok = await confirm({
        title: 'Save anyway?',
        message: `${placeholderWarn} The brainstorm may not work as expected. Save anyway?`,
        confirmLabel: 'Save',
      })
      if (!ok) return
    }

    setBusy(true)
    setMessage('')
    try {
      const next: Record<string, unknown> = {
        ...settings,
        brainstorm: {
          batch_size: form.batch_size,
          max_retries_per_turn: form.max_retries_per_turn,
          retry_backoff_ms: backoff.value,
          templates: { ...form.templates },
        },
      }
      // Main logs `Config saved` whenever the config file is rewritten, so
      // there's nothing extra to record from the renderer side here.
      await updateSettings(next)
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [form, settings, updateSettings, onClose, confirm])

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
            Sent to the text AI verbatim with placeholders substituted. The shipped text-AI defaults wrap inserted content in explicit XML-like tags so the model can see where embedded strings end; preserving that pattern is recommended when editing. <code>{'{{JSON}}'}</code> always resolves to the required response shape <code>{'{ "prompts": [string, ...] }'}</code>, so the parser cannot be broken by edits to that part.
          </p>

          <label className="elaboration-settings-template">
            <span>First message — no previous prompts</span>
            <span className="elaboration-settings-tags">{'{{ELABORATOR}} {{SEED}} {{N}} {{JSON}}'}</span>
            <textarea
              rows={10}
              value={form.templates.first_no_previous}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, first_no_previous: e.target.value } })}
            />
          </label>

          <label className="elaboration-settings-template">
            <span>First message — with previous prompts</span>
            <span className="elaboration-settings-tags">{'{{ELABORATOR}} {{SEED}} {{PREVIOUS}} {{N}} {{JSON}}'}</span>
            <textarea
              rows={12}
              value={form.templates.first_with_previous}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, first_with_previous: e.target.value } })}
            />
          </label>

          <label className="elaboration-settings-template">
            <span>Continuation message</span>
            <span className="elaboration-settings-tags">{'{{N}} {{JSON}}'}</span>
            <textarea
              rows={3}
              value={form.templates.continuation}
              onChange={(e) => setForm({ ...form, templates: { ...form.templates, continuation: e.target.value } })}
            />
          </label>

          <div className="elaboration-settings-reset-row">
            <button className="modal-btn modal-btn-danger" onClick={() => void handleReset()} disabled={busy}>
              Reset to Defaults
            </button>
          </div>
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
