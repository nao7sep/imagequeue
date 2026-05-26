import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useConfirm } from '../context/ConfirmContext'
import type { Elaborator, ElaboratorKind } from '../../../shared/types'
import { ELABORATOR_KIND_LABELS } from '../../../shared/types'
import './ElaboratorsModal.css'

interface Props {
  onClose: () => void
}

interface DraftState {
  name: string
  description: string
  template: string
}

interface DraftTarget {
  kind: ElaboratorKind
  mode: 'new' | 'edit'
  id?: string
}

const EMPTY_DRAFT: DraftState = { name: '', description: '', template: '' }
const ELABORATOR_KINDS: ElaboratorKind[] = ['content', 'composition', 'style']

function groupElaborators(items: Elaborator[]): Record<ElaboratorKind, Elaborator[]> {
  return {
    content: items.filter((item) => item.kind === 'content'),
    composition: items.filter((item) => item.kind === 'composition'),
    style: items.filter((item) => item.kind === 'style'),
  }
}

export function ElaboratorsModal({ onClose }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const [items, setItems] = useState<Elaborator[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedIds, setSelectedIds] = useState<Record<ElaboratorKind, string | null>>({
    content: null,
    composition: null,
    style: null,
  })
  const [draftTarget, setDraftTarget] = useState<DraftTarget | null>(null)
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  const editorRef = useRef<HTMLDivElement>(null)

  const groupedItems = useMemo(() => groupElaborators(items), [items])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await window.electronAPI.listElaborators()
      setItems(next)
      const grouped = groupElaborators(next)
      setSelectedIds((prev) => ({
        content: grouped.content.some((item) => item.id === prev.content) ? prev.content : grouped.content[0]?.id ?? null,
        composition: grouped.composition.some((item) => item.id === prev.composition) ? prev.composition : grouped.composition[0]?.id ?? null,
        style: grouped.style.some((item) => item.id === prev.style) ? prev.style : grouped.style[0]?.id ?? null,
      }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!draftTarget) return
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [draftTarget])

  const dirty = useMemo(() => {
    if (!draftTarget) return false
    if (draftTarget.mode === 'new') {
      return draft.name.trim() !== '' || draft.description.trim() !== '' || draft.template.trim() !== ''
    }
    const original = items.find((item) => item.id === draftTarget.id)
    if (!original) return false
    return draft.name !== original.name
      || draft.description !== (original.description ?? '')
      || draft.template !== original.template
  }, [draft, draftTarget, items])

  const startNew = (kind: ElaboratorKind): void => {
    if (busy || draftTarget) return
    setDraftTarget({ kind, mode: 'new' })
    setDraft({ ...EMPTY_DRAFT })
    setMessage('')
  }

  const startEdit = (kind: ElaboratorKind): void => {
    if (busy || draftTarget) return
    const selectedId = selectedIds[kind]
    const item = selectedId ? items.find((candidate) => candidate.id === selectedId) : null
    if (!item) return
    setDraftTarget({ kind, mode: 'edit', id: item.id })
    setDraft({
      name: item.name,
      description: item.description ?? '',
      template: item.template,
    })
    setMessage('')
  }

  const cancelDraft = (): void => {
    setDraftTarget(null)
    setDraft(EMPTY_DRAFT)
    setMessage('')
  }

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!draftTarget) return
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
      let savedId: string | null = null
      if (draftTarget.mode === 'edit' && draftTarget.id) {
        const updated = await window.electronAPI.updateElaborator(draftTarget.id, {
          name: draft.name,
          description: draft.description,
          template: draft.template,
        })
        savedId = updated?.id ?? draftTarget.id
      } else {
        const created = await window.electronAPI.createElaborator({
          kind: draftTarget.kind,
          name: draft.name,
          description: draft.description || undefined,
          template: draft.template,
        })
        savedId = created.id
      }
      setDraftTarget(null)
      setDraft(EMPTY_DRAFT)
      await refresh()
      if (savedId) {
        setSelectedIds((prev) => ({ ...prev, [draftTarget.kind]: savedId }))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [draft, draftTarget, refresh])

  const handleDelete = useCallback(async (kind: ElaboratorKind): Promise<void> => {
    const selectedId = selectedIds[kind]
    const item = selectedId ? items.find((candidate) => candidate.id === selectedId) : null
    if (!item) return
    const ok = await confirm({
      title: `Delete ${ELABORATOR_KIND_LABELS[kind]} Elaborator`,
      message: `Delete "${item.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setMessage('')
    try {
      await window.electronAPI.deleteElaborator(item.id)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [confirm, items, refresh, selectedIds])

  const handleReset = useCallback(async (kind: ElaboratorKind): Promise<void> => {
    const ok = await confirm({
      title: `Reset ${ELABORATOR_KIND_LABELS[kind]} Elaborators`,
      message: `Replace all ${kind} elaborators with the shipped defaults?`,
      confirmLabel: 'Reset',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setMessage('')
    try {
      await window.electronAPI.resetElaborators(kind)
      if (draftTarget?.kind === kind) cancelDraft()
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [confirm, draftTarget, refresh])

  const handleRequestClose = useCallback(async (): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'You have an unsaved elaborator draft. Close without saving?',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, confirm, onClose])

  const renderEditor = (kind: ElaboratorKind): React.JSX.Element => (
    <div className="elaborator-editor" ref={editorRef}>
      <div className="elaborator-editor-title">
        {draftTarget?.mode === 'new' ? `New ${ELABORATOR_KIND_LABELS[kind]} Elaborator` : `Edit ${ELABORATOR_KIND_LABELS[kind]} Elaborator`}
      </div>
      <label className="elaborator-field">
        <span>Name</span>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Short name shown in the list"
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
          rows={10}
          value={draft.template}
          onChange={(e) => setDraft({ ...draft, template: e.target.value })}
          placeholder="System instruction sent to the text AI."
        />
      </label>
      <div className="elaborator-editor-actions">
        <button className="modal-btn" onClick={cancelDraft} disabled={busy}>Cancel</button>
        <button className="modal-btn modal-btn-primary" onClick={() => void saveDraft()} disabled={busy}>
          Save
        </button>
      </div>
    </div>
  )

  const renderPane = (kind: ElaboratorKind): React.JSX.Element => {
    const itemsForKind = groupedItems[kind]
    const selectedId = selectedIds[kind]
    const draftOpenHere = draftTarget?.kind === kind

    return (
      <section key={kind} className="elaborators-pane">
        <div className="elaborators-pane-header">
          <div className="elaborators-pane-title">{ELABORATOR_KIND_LABELS[kind]}</div>
          <div className="elaborators-pane-actions">
            <button
              className="modal-btn modal-btn-primary"
              onClick={() => startNew(kind)}
              disabled={busy || draftTarget !== null}
            >
              New
            </button>
            <button
              className="modal-btn"
              onClick={() => startEdit(kind)}
              disabled={busy || draftTarget !== null || !selectedId}
            >
              Edit
            </button>
            <button
              className="modal-btn modal-btn-danger"
              onClick={() => void handleDelete(kind)}
              disabled={busy || draftTarget !== null || !selectedId}
            >
              Delete
            </button>
          </div>
        </div>

        <div className="elaborators-pane-body">
          {draftOpenHere && renderEditor(kind)}

          {loading ? (
            <div className="elaborators-empty">Loading…</div>
          ) : itemsForKind.length === 0 && !draftOpenHere ? (
            <div className="elaborators-empty">No {ELABORATOR_KIND_LABELS[kind].toLowerCase()} elaborators yet.</div>
          ) : (
            <div className="elaborators-list">
              {itemsForKind.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`elaborator-row${selectedId === item.id ? ' selected' : ''}`}
                  onClick={() => setSelectedIds((prev) => ({ ...prev, [kind]: item.id }))}
                  disabled={busy || (draftTarget !== null && !draftOpenHere)}
                >
                  <div className="elaborator-row-text">
                    <div className="elaborator-row-name">{item.name}</div>
                    {item.description && <div className="elaborator-row-desc">{item.description}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="elaborators-pane-footer">
          <button
            className="modal-btn modal-btn-danger"
            onClick={() => void handleReset(kind)}
            disabled={busy || draftTarget !== null}
          >
            Reset Defaults
          </button>
        </div>
      </section>
    )
  }

  return (
    <Modal title="Elaborators" className="elaborators-modal-box" onClose={() => void handleRequestClose()}>
      <div className="elaborators-body">
        {message && <div className="elaborators-message">{message}</div>}
        <div className="elaborators-grid">
          {ELABORATOR_KINDS.map((kind) => renderPane(kind))}
        </div>
      </div>
    </Modal>
  )
}
