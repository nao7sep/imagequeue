import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useConfirm } from '../context/ConfirmContext'
import type { Elaborator } from '../../../shared/types'
import './ElaboratorsModal.css'

interface Props {
  onClose: () => void
  onChange?: (items: Elaborator[]) => void
}

interface DraftState {
  name: string
  description: string
  template: string
}

const EMPTY_DRAFT: DraftState = { name: '', description: '', template: '' }

export function ElaboratorsModal({ onClose, onChange }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const [items, setItems] = useState<Elaborator[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const listRef = useRef<HTMLDivElement>(null)
  const editEditorRef = useRef<HTMLDivElement>(null)

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

  // Scroll into view only when editing — the new-editor renders at the top
  // of the list and is already visible, no scroll needed.
  useEffect(() => {
    if (editingId) {
      editEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [editingId])

  const startNew = (): void => {
    if (busy) return
    setEditingId(null)
    setDraft({ ...EMPTY_DRAFT })
    setCreating(true)
    setMessage('')
  }

  const startEdit = (item: Elaborator): void => {
    if (busy) return
    setCreating(false)
    setEditingId(item.id)
    setDraft({
      name: item.name,
      description: item.description ?? '',
      template: item.template,
    })
    setMessage('')
  }

  const cancelDraft = (): void => {
    setCreating(false)
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setMessage('')
  }

  const saveDraft = useCallback(async (): Promise<void> => {
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
      if (editingId) {
        await window.electronAPI.updateElaborator(editingId, {
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
      cancelDraft()
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [draft, editingId, refresh])

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
      if (editingId === item.id) cancelDraft()
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [confirm, editingId, refresh])

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
      cancelDraft()
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [confirm, refresh])

  const renderEditor = (mode: 'new' | 'edit'): React.JSX.Element => (
    <div
      className="elaborator-editor"
      ref={mode === 'edit' ? editEditorRef : undefined}
    >
      <div className="elaborator-editor-title">{mode === 'new' ? 'New Elaborator' : 'Edit Elaborator'}</div>
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
        <button className="elaborators-btn" onClick={cancelDraft} disabled={busy}>Cancel</button>
        <button className="elaborators-btn elaborators-btn-primary" onClick={() => void saveDraft()} disabled={busy}>
          Save
        </button>
      </div>
    </div>
  )

  return (
    <Modal title="Elaborators" className="elaborators-modal-box" onClose={onClose}>
      <div className="elaborators-body" ref={listRef}>
        <div className="elaborators-toolbar">
          <button
            className="elaborators-btn elaborators-btn-primary"
            onClick={startNew}
            disabled={busy || creating || editingId !== null}
          >
            New Elaborator
          </button>
          <button
            className="elaborators-btn elaborators-btn-danger"
            onClick={() => void handleReset()}
            disabled={busy}
          >
            Reset to Defaults
          </button>
        </div>

        {message && <div className="elaborators-message">{message}</div>}

        {creating && renderEditor('new')}

        {loading ? (
          <div className="elaborators-empty">Loading…</div>
        ) : items.length === 0 && !creating ? (
          <div className="elaborators-empty">No elaborators yet. Click New Elaborator or Reset to Defaults.</div>
        ) : (
          <div className="elaborators-list">
            {items.map((item) => {
              if (editingId === item.id) {
                return <div key={item.id}>{renderEditor('edit')}</div>
              }
              return (
                <div key={item.id} className="elaborator-row">
                  <div className="elaborator-row-text">
                    <div className="elaborator-row-name">{item.name}</div>
                    {item.description && <div className="elaborator-row-desc">{item.description}</div>}
                  </div>
                  <div className="elaborator-row-actions">
                    <button
                      className="elaborators-btn"
                      onClick={() => startEdit(item)}
                      disabled={busy || creating || editingId !== null}
                    >
                      Edit
                    </button>
                    <button
                      className="elaborators-btn elaborators-btn-danger"
                      onClick={() => void handleDelete(item)}
                      disabled={busy || creating || editingId !== null}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
