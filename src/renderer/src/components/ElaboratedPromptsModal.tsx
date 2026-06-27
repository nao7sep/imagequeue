import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useSessionDraft } from '../context/SessionDraftContext'
import { useConfirm } from '../context/ConfirmContext'
import { useListbox } from '../hooks/useListbox'
import { truncate, PROMPT_PREVIEW_MIN_GRAPHEMES } from '../utils/textCleanup'
import './ElaboratedPromptsModal.css'

interface Props {
  onClose: () => void
}

// Lists the elaborated prompts produced in this session as a single-select
// listbox: click or arrow to highlight a prompt, Delete (key on the row, or its
// button) to remove it. Selection is the single source of truth — `selectedId` —
// exactly like the other in-app lists (Sessions, Elaborators, Models). The only
// addition is that a delete recovers BOTH the selection and DOM focus to the same
// neighbour, in one place, so the highlight and the focus cursor can never drift
// apart (the two-highlight bug). This is the same list the brainstorm orchestrator
// reads as previousPrompts, so deletions here tell the AI to stop avoiding them.
export function ElaboratedPromptsModal({ onClose }: Props): React.JSX.Element {
  const { state, deleteElaboratedPromptAt, clearElaboratedPrompts } = useSessionDraft()
  const confirm = useConfirm()
  const { elaboratedPrompts } = state

  // Rows newest-first, each with a STABLE content-derived id (prompt text plus its
  // occurrence among identical texts), so an id never renumbers when a row above
  // it is deleted.
  const seen = new Map<string, number>()
  const rows = [...elaboratedPrompts].reverse().map((prompt, index) => {
    const occ = seen.get(prompt) ?? 0
    seen.set(prompt, occ + 1)
    return {
      id: `${occ} ${prompt}`,
      prompt,
      originalIndex: elaboratedPrompts.length - 1 - index,
    }
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // When a delete is initiated, the display slot to recover selection + focus to
  // (the neighbour that slides into it).
  const recoverIndexRef = useRef<number | null>(null)

  const { listboxProps, getOptionProps } = useListbox<HTMLOListElement>({
    ids: rows.map((r) => r.id),
    selectedId,
    onSelect: setSelectedId,
    activation: 'follows-focus',
    typeAhead: false,
  })

  const focusOption = (id: string): void => {
    listboxProps.ref.current
      ?.querySelector<HTMLElement>(`[data-listbox-option="${CSS.escape(id)}"]`)
      ?.focus()
  }

  // The one place selection (and, after a delete, focus) reconciles with the list.
  // On a delete: move both to the neighbour that took the slot. Otherwise (open, or
  // the selection drifted away): keep it on a live row.
  useEffect(() => {
    const idx = recoverIndexRef.current
    recoverIndexRef.current = null
    if (idx !== null) {
      const target = rows.length > 0 ? rows[Math.min(idx, rows.length - 1)] : null
      setSelectedId(target?.id ?? null)
      if (target) focusOption(target.id)
      return
    }
    setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null))
    // rows derive from elaboratedPrompts; reconcile only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elaboratedPrompts])

  // Focus the active row when the modal opens, so the arrow keys navigate
  // immediately — the modal shell would otherwise focus the header close button.
  useEffect(() => {
    const list = listboxProps.ref.current
    ;(
      list?.querySelector<HTMLElement>('[data-listbox-option][tabindex="0"]') ??
      list?.querySelector<HTMLElement>('[data-listbox-option]')
    )?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Delete the row at display index `idx`; recovery (above) lands selection + focus
  // on its neighbour, so the list never loses its cursor and arrows keep working.
  const deleteRow = (idx: number): void => {
    recoverIndexRef.current = idx
    deleteElaboratedPromptAt(rows[idx].originalIndex)
  }

  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      const idx = rows.findIndex((r) => r.id === selectedId)
      if (idx >= 0) {
        e.preventDefault()
        deleteRow(idx)
        return
      }
    }
    listboxProps.onKeyDown(e)
  }

  const handleClearAll = useCallback(async (): Promise<void> => {
    if (elaboratedPrompts.length === 0) return
    const ok = await confirm({
      title: 'Delete all prompts',
      message: `Remove all ${elaboratedPrompts.length} prompt${elaboratedPrompts.length === 1 ? '' : 's'} from this session's list? Future brainstorm calls will start with no "previously elaborated" context.`,
      confirmLabel: 'Delete all',
      danger: true,
    })
    if (!ok) return
    clearElaboratedPrompts()
  }, [confirm, clearElaboratedPrompts, elaboratedPrompts.length])

  return (
    <Modal
      title="Elaborated Prompts"
      className="elaborated-prompts-modal-box"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="modal-btn modal-btn-danger modal-footer-lead"
            onClick={() => void handleClearAll()}
            disabled={elaboratedPrompts.length === 0}
          >
            Delete All
          </button>
          <button type="button" className="modal-btn" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="elaborated-prompts-body">
        {elaboratedPrompts.length === 0 ? (
          <div className="elaborated-prompts-empty">
            No prompts elaborated in this session yet. Open Advanced Prompting and click Elaborate, or queue with a fresh-elaboration mode, to produce some.
          </div>
        ) : (
          <ol
            {...listboxProps}
            onKeyDown={onListKeyDown}
            className="elaborated-prompts-list"
            reversed
            start={elaboratedPrompts.length}
          >
            {rows.map((row, index) => {
              const displayNumber = elaboratedPrompts.length - index
              return (
                <li key={row.id} className="elaborated-prompts-row" {...getOptionProps(row.id)}>
                  <div className="elaborated-prompts-number" aria-hidden="true">{displayNumber}.</div>
                  {/* One-line preview: flatten + cap to a generous budget; CSS
                      clamps visually, the full prompt lives in the title tooltip. */}
                  <div className="elaborated-prompts-text" title={row.prompt}>
                    {truncate(row.prompt, PROMPT_PREVIEW_MIN_GRAPHEMES).text}
                  </div>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="modal-btn modal-btn-danger"
                    onClick={() => deleteRow(index)}
                    title="Remove this prompt from the session list (or press Delete on the row)"
                  >
                    Delete
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Modal>
  )
}
