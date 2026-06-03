import { useCallback } from 'react'
import { Modal } from './Modal'
import { useAdvancedPrompting } from '../context/AdvancedPromptingContext'
import { useConfirm } from '../context/ConfirmContext'
import './ElaboratedPromptsModal.css'

interface Props {
  onClose: () => void
}

// Lists the elaborated prompts produced in this session. This is the same
// list the brainstorm orchestrator reads as previousPrompts, so deletions
// here genuinely tell the AI to stop avoiding those prompts on future calls.
export function ElaboratedPromptsModal({ onClose }: Props): React.JSX.Element {
  const { state, deleteElaboratedPromptAt, clearElaboratedPrompts } = useAdvancedPrompting()
  const confirm = useConfirm()
  const { elaboratedPrompts } = state
  const displayPrompts = [...elaboratedPrompts].reverse()

  // Per-row delete is unconfirmed — trimming a long generated list is a routine
  // cleanup gesture (cf. the queue's confirm-off default for task removal).
  // Delete All stays confirmed because its blast radius is the whole session list.
  const handleDelete = useCallback((index: number): void => {
    deleteElaboratedPromptAt(index)
  }, [deleteElaboratedPromptAt])

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
    <Modal title="Elaborated Prompts" className="elaborated-prompts-modal-box" onClose={onClose}>
      <div className="elaborated-prompts-body">
        {elaboratedPrompts.length === 0 ? (
          <div className="elaborated-prompts-empty">
            No prompts elaborated in this session yet. Open Advanced Prompting and click Elaborate, or queue with a fresh-elaboration mode, to produce some.
          </div>
        ) : (
          <ol className="elaborated-prompts-list" reversed start={elaboratedPrompts.length}>
            {displayPrompts.map((prompt, index) => {
              const originalIndex = elaboratedPrompts.length - 1 - index
              const displayNumber = elaboratedPrompts.length - index
              return (
                <li key={`${originalIndex}-${prompt.slice(0, 24)}`} className="elaborated-prompts-row">
                  <div className="elaborated-prompts-number" aria-hidden="true">{displayNumber}.</div>
                  <div className="elaborated-prompts-text">{prompt}</div>
                  <button
                    type="button"
                    className="modal-btn modal-btn-danger"
                    onClick={() => handleDelete(originalIndex)}
                    title="Remove this prompt from the session list"
                  >
                    Delete
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <div className="elaborated-prompts-footer">
        <button
          type="button"
          className="modal-btn modal-btn-danger"
          onClick={() => void handleClearAll()}
          disabled={elaboratedPrompts.length === 0}
        >
          Delete All
        </button>
        <button type="button" className="modal-btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}
