import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useConfirm } from '../context/ConfirmContext'
import type { Elaborator } from '../../../shared/types'
import './ElaboratorsModal.css'

interface Props {
  onClose: () => void
  onChange?: (items: Elaborator[]) => void
}

interface DraftState {
  id: string | null
  name: string
  description: string
  template: string
}

const EMPTY_DRAFT: DraftState = { id: null, name: '', description: '', template: '' }

export function ElaboratorsModal({ onClose, onChange }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const [items, setItems] = useState<Elaborator[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await window.electronAPI.listElaborators()
      setItems(next)
      onChange?.(next)
    } finally {
      setLoading(false)
    }
  }, [onChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startNew = (): void => {
    setDraft({ ...EMPTY_DRAFT })
    setMessage('')
  }

  const startEdit = (item: Elaborator): void => {
    setDraft({
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      template: item.template,
    })
    setMessage('')
  }

  const cancelDraft = (): void => {
    setDraft(null)
  }

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!draft) return
    if (!draft.name.trim()) {
      setMessage('Name is required.')
      return
    }
    if (!draft.template.trim()) {
      setMessage('Template is required.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      if (draft.id) {
        await window.electronAPI.updateElaborator(draft.id, {
          name: draft.name,
          description: draft.description,
          template: draft.template,
        })
      } else {
        await window.electronAPI.createElaborator({
          name: draft.name,
          description: draft.description || undefined,
          template: draft.template,
        })
      }
      setDraft(null)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [draft, refresh])

  const handleDelete = useCallback(async (item: Elaborator): Promise<void> => {
    const ok = await confirm({
      title: 'Delete Elaborator',
      message: `Delete "${item.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setMessage('')
    try {
      await window.electronAPI.deleteElaborator(item.id)
      if (draft?.id === item.id) setDraft(null)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [confirm, draft, refresh])

  const handleReset = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Reset Elaborators',
      message: 'Replace all elaborators with the shipped defaults? Your current list will be lost.',
      confirmLabel: 'Reset',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setMessage('')
    try {
      await window.electronAPI.resetElaborators()
      setDraft(null)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [confirm, refresh])

  return (
    <Modal title="Elaborators" className="elaborators-modal-box" onClose={onClose}>
      <div className="elaborators-body">
        <div className="elaborators-toolbar">
          <button className="session-card-btn session-card-btn-primary" onClick={startNew} disabled={busy || draft !== null}>
            + New
          </button>
          <button className="session-card-btn session-card-btn-danger" onClick={() => void handleReset()} disabled={busy}>
            Reset to Defaults
          </button>
        </div>

        {message && <div className="elaborators-message">{message}</div>}

        {loading ? (
          <div className="elaborators-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="elaborators-empty">No elaborators yet. Click + New or Reset to Defaults.</div>
        ) : (
          <div className="elaborators-list">
            {items.map((item) => (
              <div key={item.id} className="elaborator-row">
                <div className="elaborator-row-text">
                  <div className="elaborator-row-name">{item.name}</div>
                  {item.description && <div className="elaborator-row-desc">{item.description}</div>}
                </div>
                <div className="elaborator-row-actions">
                  <button className="session-card-btn" onClick={() => startEdit(item)} disabled={busy || draft !== null}>
                    Edit
                  </button>
                  <button
                    className="session-card-btn session-card-btn-danger"
                    onClick={() => void handleDelete(item)}
                    disabled={busy || draft !== null}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {draft && (
          <div className="elaborator-editor">
            <div className="elaborator-editor-title">{draft.id ? 'Edit Elaborator' : 'New Elaborator'}</div>
            <label className="elaborator-field">
              <span>Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. App icon"
              />
            </label>
            <label className="elaborator-field">
              <span>Description (optional)</span>
              <input
                type="text"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Short hint shown under the name"
              />
            </label>
            <label className="elaborator-field">
              <span>Template</span>
              <textarea
                rows={6}
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                placeholder="System instruction sent to the text AI."
              />
            </label>
            <div className="elaborator-editor-actions">
              <button className="session-card-btn" onClick={cancelDraft} disabled={busy}>Cancel</button>
              <button className="session-card-btn session-card-btn-primary" onClick={() => void saveDraft()} disabled={busy}>
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
