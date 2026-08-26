import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import type { ElaboratedPromptRecord } from '../../../shared/types'
import { multiline } from '../../../shared/textCleanup'
import {
  buildAdvancedQueueUnits,
  promptsNeeded,
  type AdvancedQueueTarget,
} from '../utils/advancedQueueUnits'
import { resolveAdvancedTargets } from '../utils/advancedTargets'
import { dtFallbacksFromSettings, resolveDtParams, toDrawThingsTaskParams } from '../utils/drawThingsParams'
import { hasApiKeyFor } from '../utils/enqueue'
import {
  MAX_DRAFT_ITERATIONS,
  normalizeCount,
  PROMPT_FORMATS,
  PROMPT_LENGTHS,
  PROMPT_FORMAT_LABELS,
  PROMPT_LENGTH_LABELS,
  type PromptMode,
} from '../../../shared/session-draft'
import {
  BACKEND_LABELS,
  CLOUD_BACKEND_IDS_IN_UI_ORDER,
  type BackendId,
  type Elaborator,
  ELABORATOR_KIND_LABELS,
  type ElaboratorKind,
  type LocalModelInfo,
} from '../../../shared/types'
import { localModelName, sortLocalModels } from '../utils/localModels'
import { isBrainstormMode } from '../utils/promptMode'
import {
  computeAdvancedGates,
  promptModeDisabledReason as promptModeDisabledReasonFor,
  describeBrainstormProgress,
  type ActiveOperation,
} from '../utils/advancedPromptingGates'
import { ElaboratedPromptsModal } from './ElaboratedPromptsModal'
import { useBrainstormOperation } from '../hooks/useBrainstormOperation'
import './AdvancedPromptingModal.css'

// How long the "Queued N tasks." receipt stays on screen before the modal
// closes. Long enough to register, short enough not to feel like a stall.
const QUEUE_COMPLETION_HOLD_MS = 900

interface Props {
  onClose: () => void
}

const isMacPlatform = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
const ELABORATOR_KINDS: ElaboratorKind[] = ['composition', 'style']

function groupElaborators(items: Elaborator[]): Record<ElaboratorKind, Elaborator[]> {
  return {
    composition: items.filter((item) => item.kind === 'composition'),
    style: items.filter((item) => item.kind === 'style'),
  }
}

export function AdvancedPromptingModal({ onClose }: Props): React.JSX.Element {
  const { settings, apiKeyPresence } = useSettings()
  const confirm = useConfirm()
  const { snapshots } = useEnqueueConfigs()
  const { state, update, appendElaboratedPrompts } = useSessionDraft()
  const {
    prompt, seed, selectedCompositionElaboratorId, selectedStyleElaboratorId, elaborated,
    selectedProprietary, selectedDtFiles, promptMode, targetScope, count, elaboratedPrompts,
    promptFormat, promptLength,
  } = state

  // Pre-fill the seed from the main prompt on first open within a session,
  // and only when the user has nothing typed yet. Once the user has anything
  // in the seed, we leave it alone — including across modal open/close — so
  // their work is preserved when reopening within the same session.
  useEffect(() => {
    if (!seed && prompt.trim()) {
      update({ seed: prompt })
    }
    // Intentionally only on mount: later prompt edits shouldn't clobber the seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [elaborators, setElaborators] = useState<Elaborator[]>([])
  const [elaboratorsLoading, setElaboratorsLoading] = useState(true)
  const [elaboratorsError, setElaboratorsError] = useState('')
  // Elaborate and Queue are mutually exclusive: both drive the single brainstorm
  // engine, so at most one runs at a time. One value (not a boolean per action)
  // means there is no second flag a control can read by mistake.
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null)
  // The footer's terminal line, held briefly before the modal closes. The prose
  // wave lands in a burst, so the live counter can jump from a low number
  // straight to done — closing at that instant reads as a half-finished run.
  const [completionNote, setCompletionNote] = useState('')
  // True only during the post-queue receipt hold: everything is already
  // committed, so a close during it must neither warn about discarding work
  // (nothing will be discarded) nor cancel anything — just close.
  const holdingRef = useRef(false)
  const [downloadedDtModels, setDownloadedDtModels] = useState<LocalModelInfo[]>([])
  const [dtModelsLoading, setDtModelsLoading] = useState(isMacPlatform)
  const [dtModelsError, setDtModelsError] = useState('')
  // Only errors surface in the modal: a successful queue closes it (the now-
  // populated queue columns are the confirmation), so there is no info state.
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const elaboratorRowRefs = useRef(new Map<string, HTMLLabelElement>())
  // Set to true when the user confirms closing mid-operation, so that any still-
  // in-flight async continuations know to discard their results rather than
  // append prompts or enqueue tasks.
  const cancelledRef = useRef(false)
  const elaboratorsByKind = useMemo(() => groupElaborators(elaborators), [elaborators])

  const refreshElaborators = useCallback(async (): Promise<void> => {
    setElaboratorsLoading(true)
    setElaboratorsError('')
    try {
      const next = await window.electronAPI.listElaborators()
      setElaborators(next)
      const grouped = groupElaborators(next)
      update({
        selectedCompositionElaboratorId: grouped.composition.some((e) => e.id === selectedCompositionElaboratorId)
          ? selectedCompositionElaboratorId
          : grouped.composition[0]?.id ?? null,
        selectedStyleElaboratorId: grouped.style.some((e) => e.id === selectedStyleElaboratorId)
          ? selectedStyleElaboratorId
          : grouped.style[0]?.id ?? null,
      })
    } catch (loadError) {
      setElaboratorsError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setElaboratorsLoading(false)
    }
  }, [selectedCompositionElaboratorId, selectedStyleElaboratorId, update])

  useEffect(() => {
    void refreshElaborators()
  }, [refreshElaborators])

  useEffect(() => {
    for (const id of [selectedCompositionElaboratorId, selectedStyleElaboratorId]) {
      if (!id) continue
      elaboratorRowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedCompositionElaboratorId, selectedStyleElaboratorId, elaborators])

  useEffect(() => {
    if (!isMacPlatform) {
      setDownloadedDtModels([])
      setDtModelsLoading(false)
      return
    }
    setDtModelsLoading(true)
    setDtModelsError('')
    void window.electronAPI.localListDownloadedModels()
      .then((list) => setDownloadedDtModels(sortLocalModels(list)))
      .catch((loadError) => setDtModelsError(loadError instanceof Error ? loadError.message : String(loadError)))
      .finally(() => setDtModelsLoading(false))
  }, [])

  // From the presence signal, not settings' stored api_key string — see
  // hasApiKeyFor. Reading the stored value here hid env-configured backends
  // from the batch targets just as it disabled their column.
  const proprietaryApiKeyByBackend = useMemo<Record<string, boolean>>(() => {
    const result: Record<string, boolean> = {}
    for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      result[id] = hasApiKeyFor(id, apiKeyPresence)
    }
    return result
  }, [apiKeyPresence])

  // Draw Things fallback params read straight from config: config-store's
  // deepMergeDefaults guarantees these keys exist, so the defaults live in one
  // place (config/defaults.ts) rather than being re-hardcoded here. Null only in
  // the brief window before settings load — buildDtParams halts in that case
  // instead of inventing values.
  const drawThingsFallbacks = useMemo(() => {
    const params = (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
      ?.default_params as Record<string, unknown> | undefined
    if (!params) return null
    // Same derivation the column uses (drawThingsParams.ts) — null stays the
    // still-loading sentinel that buildDtParams halts on.
    return dtFallbacksFromSettings(settings as Record<string, unknown>)
  }, [settings])

  const toggleProprietary = (id: BackendId): void => {
    update({ selectedProprietary: { ...selectedProprietary, [id]: !selectedProprietary[id] } })
  }

  const toggleDtFile = (file: string): void => {
    const present = selectedDtFiles.includes(file)
    update({
      selectedDtFiles: present
        ? selectedDtFiles.filter((f) => f !== file)
        : [...selectedDtFiles, file],
    })
  }

  const effectiveTargets = useMemo(() => {
    return resolveAdvancedTargets({
      scope: targetScope,
      selectedProprietary,
      selectedDtFiles,
      downloadedDtModels,
      proprietaryEnabled: proprietaryApiKeyByBackend,
    })
  }, [targetScope, selectedProprietary, selectedDtFiles, downloadedDtModels, proprietaryApiKeyByBackend])

  const targetCount = effectiveTargets.proprietary.length + effectiveTargets.dt.length
  const totalTasks = Math.max(0, targetCount * Math.max(1, count))
  const picks = {
    composition: selectedCompositionElaboratorId !== null && elaboratorsByKind.composition.some((e) => e.id === selectedCompositionElaboratorId),
    style: selectedStyleElaboratorId !== null && elaboratorsByKind.style.some((e) => e.id === selectedStyleElaboratorId),
  }
  // Single source of truth for the three action surfaces (Elaborate, Queue,
  // Elaborated history). While an operation runs, all three are disabled so the
  // single brainstorm engine is never driven twice at once; when idle, each
  // reflects its own precondition reason.
  const gates = computeAdvancedGates({
    activeOperation,
    seedFilled: seed.trim().length > 0,
    elaboratedFilled: elaborated.trim().length > 0,
    picks,
    promptMode,
    totalTasks,
  })
  const brainstorm = useBrainstormOperation({
    compositionElaboratorId: selectedCompositionElaboratorId,
    styleElaboratorId: selectedStyleElaboratorId,
    seed,
    format: promptFormat,
    length: promptLength,
  })
  const busy = gates.busy
  const statusText = completionNote || describeBrainstormProgress(activeOperation, brainstorm.progress)

  // Note: we do NOT auto-reset promptMode when preconditions go away. On
  // modal open, one or more category selections can transiently read as
  // missing before elaborators load, which would silently wipe a persisted
  // fresh-* mode. The radio disabled state and the queue gate already signal a
  // problem.
  const promptModeDisabledReason = (which: PromptMode): string | null =>
    promptModeDisabledReasonFor(which, elaborated.trim().length > 0, gates.missingElaboratorKind)

  const handleElaborate = useCallback(async (): Promise<void> => {
    if (gates.elaborate.disabled) return
    setActiveOperation('elaborate')
    setError('')
    void window.electronAPI.appLog('info', 'Advanced: Elaborate clicked', {
      compositionElaborator: elaboratorsByKind.composition.find((e) => e.id === selectedCompositionElaboratorId)?.name ?? null,
      styleElaborator: elaboratorsByKind.style.find((e) => e.id === selectedStyleElaboratorId)?.name ?? null,
      seedLen: seed.length,
      sessionPromptCount: elaboratedPrompts.length,
    })
    try {
      const newPrompts = await brainstorm.run(1)
      if (cancelledRef.current) return
      const first = newPrompts[0]
      if (!first) {
        setError('Text AI returned no prompt.')
        return
      }
      const firstText = first.text
      // Elaborate is a preview: fill the elaborated box and record the result in
      // the session history (which the Prompts list reads, and which "Elaborated
      // prompt (same for all)" queues from), but leave the user's prompt-source
      // selection alone. Switching it here would hijack a deliberate choice just
      // because they wanted to see one sample.
      update({ elaborated: firstText })
      appendElaboratedPrompts([first])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActiveOperation(null)
    }
  }, [
    gates.elaborate.disabled, brainstorm, elaboratedPrompts.length, update, appendElaboratedPrompts,
    elaboratorsByKind, selectedCompositionElaboratorId, selectedStyleElaboratorId, seed,
  ])

  // Resolution and gating shared with the column (drawThingsParams.ts): saved
  // params take the whole set, else recommendation over configured fallbacks.
  const buildDtParams = useCallback(async (modelFile: string): Promise<AdvancedQueueTarget> => {
    const saved = await window.electronAPI.dtGetModelParams(modelFile)
    const rec = saved ? null : await window.electronAPI.resolveRecommendation(modelFile)
    // Saved params need no fallbacks; a resolution without them halts rather
    // than inventing values (the non-null assertion below is covered by this).
    if (!saved && !drawThingsFallbacks) {
      throw new Error('Draw Things settings are still loading — try again in a moment.')
    }
    const resolved = resolveDtParams(saved, rec, drawThingsFallbacks!)
    return { backend: 'drawthings', model: modelFile, params: toDrawThingsTaskParams(resolved) }
  }, [drawThingsFallbacks])

  const handleQueue = useCallback(async (): Promise<void> => {
    if (gates.queue.disabled) return
    setActiveOperation('queue')
    setError('')
    setCompletionNote('')
    const targets = effectiveTargets
    const copies = Math.max(1, count)
    const allTargetCount = targetCount
    let succeeded = false
    void window.electronAPI.appLog('info', 'Advanced: Queue clicked', {
      mode: promptMode,
      proprietaryCount: targets.proprietary.length,
      drawthingsCount: targets.dt.length,
      iterations: copies,
      totalTasks: allTargetCount * copies,
      sessionPromptCount: elaboratedPrompts.length,
    })
    try {

      // Pre-generate prompts according to mode.
      // - as-is / elaborated: a single prompt reused for everything.
      // - fresh-iteration: one prompt per iteration, shared across models. Length = copies.
      // - fresh-task: one prompt per (model × iteration). Length = targets × copies.
      // fresh-* modes brainstorm new prompts; as-is/elaborated reuse existing
      // text. Only brainstormed prompts get recorded in the session history, and
      // only after their tasks are queued below.
      const brainstormed = isBrainstormMode(promptMode)
      // Brainstormed prompts arrive as records carrying their concept credits;
      // the task units below need only the text, but the records are what the
      // session history stores — the Prompts list shows which concepts each
      // prompt was built from.
      let records: ElaboratedPromptRecord[] = []
      let prompts: string[] = []
      if (promptMode === 'as-is') {
        // Reused prompt bodies — clean as multiline at this commit point.
        prompts = [multiline(seed)]
      } else if (promptMode === 'elaborated') {
        prompts = [multiline(elaborated)]
      } else {
        records = await brainstorm.run(promptsNeeded(promptMode, copies, allTargetCount))
        prompts = records.map((record) => record.text)
      }
      if (cancelledRef.current) return
      if (prompts.length === 0) throw new Error('No prompts to enqueue.')

      const proprietaryUnits: AdvancedQueueTarget[] = targets.proprietary.map((backendId) => {
        const snapshot = snapshots[backendId]
        if (!snapshot || !snapshot.model) {
          throw new Error(`The ${BACKEND_LABELS[backendId]} column is not ready yet.`)
        }
        return {
          backend: backendId,
          model: snapshot.model,
          params: snapshot.params,
        }
      })

      const dtUnits = await Promise.all(targets.dt.map((modelFile) => buildDtParams(modelFile)))
      const units = buildAdvancedQueueUnits({
        mode: promptMode,
        prompts,
        copies,
        targets: [...proprietaryUnits, ...dtUnits],
      })

      // Re-check after the awaits above (snapshot reads, DT param resolution):
      // a deliberate close could have landed mid-build, and nothing should be
      // queued then. No await sits between this gate and the enqueue, so it
      // can't be raced.
      if (cancelledRef.current) return
      await window.electronAPI.enqueueBatch(units)

      // Commit: the tasks now exist, so record the freshly brainstormed prompts
      // in the session history. A run that was cancelled or failed never reaches
      // this point, so it leaves no orphan entries.
      if (brainstormed) appendElaboratedPrompts(records)
      // Let the finish be SEEN before the modal goes: a receipt with the final
      // count, held just long enough to register. It replaces the surprise of
      // closing on "2 / 12" — the missing ten completed in the same burst.
      setCompletionNote(`Queued ${units.length} task${units.length === 1 ? '' : 's'}.`)
      holdingRef.current = true
      await new Promise((resolve) => setTimeout(resolve, QUEUE_COMPLETION_HOLD_MS))
      holdingRef.current = false
      succeeded = true
      // No success message: the modal closes below (after the finally clears the
      // busy state), and the now-populated queue columns are the confirmation.
      // Per-task enqueue is already logged in main; the click-time log above
      // carries the user's intent, so no separate dispatch log is needed here.
    } catch (err) {
      // Stay open so the user can read the error and retry.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActiveOperation(null)
    }
    if (succeeded) onClose()
  }, [
    gates.queue.disabled, effectiveTargets, count, targetCount, promptMode,
    seed, elaborated, brainstorm, buildDtParams, elaboratedPrompts.length,
    snapshots, appendElaboratedPrompts, onClose,
  ])

  // Esc / outside-click / X all route through here. The only time we ask the
  // user to confirm is while a long-running operation is in flight, since
  // state itself is session-scoped (closing is otherwise non-destructive).
  const handleRequestClose = useCallback(async (): Promise<void> => {
    // During the receipt hold the operation flag is still set but the work is
    // fully committed — a close is safe and needs no confirmation.
    if (holdingRef.current) {
      onClose()
      return
    }
    if (busy) {
      const ok = await confirm({
        title: 'Operation in progress',
        message: 'An elaboration or queue operation is still running. Close anyway? The prompts generated by this run will be discarded along with any unfinished work.',
        confirmLabel: 'Close',
        danger: true,
      })
      if (!ok) return
      cancelledRef.current = true
      // Stop the main-process brainstorm so it doesn't keep calling the text AI.
      // Nothing to clean up in the history: this run's prompts are only recorded
      // after its tasks are queued, which a cancelled run never reaches.
      brainstorm.cancel()
    }
    onClose()
  }, [busy, confirm, onClose, brainstorm])

  const selectElaborator = useCallback((kind: ElaboratorKind, id: string): void => {
    switch (kind) {
      case 'composition':
        update({ selectedCompositionElaboratorId: id })
        return
      case 'style':
        update({ selectedStyleElaboratorId: id })
        return
    }
  }, [update])

  const selectedElaboratorIds: Record<ElaboratorKind, string | null> = {
    composition: selectedCompositionElaboratorId,
    style: selectedStyleElaboratorId,
  }

  const renderElaboratorColumn = (kind: ElaboratorKind): React.JSX.Element => {
    const items = elaboratorsByKind[kind]
    return (
      <div className="advanced-elaborator-column" key={kind}>
        <div className="advanced-elaborator-column-title">{ELABORATOR_KIND_LABELS[kind]}</div>
        <div
          className="advanced-elaborator-column-list"
          role="radiogroup"
          aria-label={`${ELABORATOR_KIND_LABELS[kind]} elaborators`}
          aria-busy={elaboratorsLoading}
          tabIndex={items.length === 0 ? 0 : -1}
        >
          {items.length === 0 ? (
            <div className="advanced-empty">
              {elaboratorsLoading
                ? 'Loading elaborators…'
                : elaboratorsError
                  ? `Couldn’t load elaborators: ${elaboratorsError}`
                  : `No ${ELABORATOR_KIND_LABELS[kind].toLowerCase()} elaborators.`}
            </div>
          ) : (
            items.map((el) => (
              <label
                key={el.id}
                ref={(node) => {
                  if (node) {
                    elaboratorRowRefs.current.set(el.id, node)
                  } else {
                    elaboratorRowRefs.current.delete(el.id)
                  }
                }}
                className={`advanced-elab-row${selectedElaboratorIds[kind] === el.id ? ' selected' : ''}`}
              >
                <input
                  type="radio"
                  name={`advanced-elaborator-${kind}`}
                  checked={selectedElaboratorIds[kind] === el.id}
                  onChange={() => selectElaborator(kind, el.id)}
                />
                <div className="advanced-elab-text">
                  <div className="advanced-elab-name">{el.name}</div>
                  {el.description && <div className="advanced-elab-desc">{el.description}</div>}
                </div>
              </label>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <Modal
      title="Advanced Prompting"
      className="advanced-modal-box"
      closeOnBackdropClick={false}
      onClose={() => void handleRequestClose()}
      footer={
        <>
          {/* The footer's leading slot: a long run is mostly spent before any
              prompt exists, and this is the only place that says so. */}
          {statusText && (
            <span className="modal-footer-lead advanced-status" role="status">
              {statusText}
            </span>
          )}
          <button className="modal-btn" onClick={() => void handleRequestClose()}>
            Cancel
          </button>
        </>
      }
    >
      <div className={`advanced-body${isMacPlatform ? '' : ' advanced-body-no-dt'}`}>
        <div className="advanced-pane">
          <div className="advanced-pane-title">Prompt</div>
          <div className="advanced-pane-scroll advanced-pane-scroll-prompt">
            <textarea
              className="advanced-seed"
              placeholder="Seed prompt or full prompt..."
              value={seed}
              onChange={(e) => update({ seed: e.target.value })}
            />
            <div className="advanced-section-label">Elaborators</div>
            <div className="advanced-elaborator-columns">
              {ELABORATOR_KINDS.map((kind) => renderElaboratorColumn(kind))}
            </div>
            <div className="advanced-row advanced-row-end">
              <button
                className="modal-btn modal-btn-primary"
                onClick={() => void handleElaborate()}
                disabled={gates.elaborate.disabled}
                title={gates.busy ? '' : (gates.elaborate.reason ?? 'Generate one elaborated prompt')}
              >
                {activeOperation === 'elaborate' ? 'Elaborating…' : 'Elaborate'}
              </button>
            </div>
            <textarea
              className="advanced-elaborated"
              placeholder="Elaborated prompt will appear here. You can edit before queueing."
              value={elaborated}
              onChange={(e) => update({ elaborated: e.target.value })}
            />
            <div className="advanced-row advanced-row-end">
              <button
                type="button"
                className="modal-btn"
                onClick={() => setShowHistory(true)}
                disabled={gates.history.disabled}
                title="View prompts elaborated this session"
              >
                Elaborated ({elaboratedPrompts.length})
              </button>
            </div>
          </div>
        </div>

        <div className="advanced-pane">
          <div className="advanced-pane-title">Targets</div>
          <div className="advanced-pane-scroll">
            <div className="advanced-targets-list">
              {isMacPlatform && (
                <div className="advanced-targets-group-title">Proprietary</div>
              )}
              {CLOUD_BACKEND_IDS_IN_UI_ORDER.map((id) => {
                const hasKey = proprietaryApiKeyByBackend[id]
                return (
                  <label key={id} className={`advanced-target-row${hasKey ? '' : ' disabled'}`}>
                    <input
                      type="checkbox"
                      checked={!!selectedProprietary[id]}
                      disabled={!hasKey}
                      onChange={() => toggleProprietary(id)}
                    />
                    <span>{BACKEND_LABELS[id]}</span>
                    {!hasKey && <span className="advanced-target-hint">No API key</span>}
                  </label>
                )
              })}
              {isMacPlatform && (
                <>
                  <div className="advanced-targets-group-title">Draw Things</div>
                  {downloadedDtModels.length === 0 ? (
                    <div className="advanced-empty">
                      {dtModelsLoading
                        ? 'Loading models…'
                        : dtModelsError
                          ? `Couldn’t load models: ${dtModelsError}`
                          : 'No models downloaded.'}
                    </div>
                  ) : (
                    downloadedDtModels.map((m) => (
                      <label key={m.file} className="advanced-target-row" title={localModelName(m)}>
                        <input
                          type="checkbox"
                          checked={selectedDtFiles.includes(m.file)}
                          onChange={() => toggleDtFile(m.file)}
                        />
                        <span>{localModelName(m)}</span>
                      </label>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="advanced-pane advanced-pane-execution">
          <div className="advanced-pane-title">Execution</div>
          <div className="advanced-pane-scroll">
            {/* Target scope leads: "who takes what" — choose the targets (middle
                pane) the run covers before deciding how the prompt is sourced. */}
            <div className="advanced-section-label">Target scope</div>
            <div className="advanced-radio-group">
              <label className="advanced-radio">
                <input type="radio" name="target-scope" checked={targetScope === 'selected'} onChange={() => update({ targetScope: 'selected' })} />
                <span>Selected</span>
              </label>
              {isMacPlatform && (
                <>
                  <label className="advanced-radio">
                    <input type="radio" name="target-scope" checked={targetScope === 'all-proprietary'} onChange={() => update({ targetScope: 'all-proprietary' })} />
                    <span>All proprietary</span>
                  </label>
                  <label className="advanced-radio">
                    <input type="radio" name="target-scope" checked={targetScope === 'all-drawthings'} onChange={() => update({ targetScope: 'all-drawthings' })} />
                    <span>All Draw Things</span>
                  </label>
                </>
              )}
              <label className="advanced-radio">
                <input type="radio" name="target-scope" checked={targetScope === 'all'} onChange={() => update({ targetScope: 'all' })} />
                <span>All</span>
              </label>
            </div>

            <div className="advanced-section-label">Prompt source</div>
            <div className="advanced-radio-group">
              <label className="advanced-radio">
                <input type="radio" name="prompt-mode" checked={promptMode === 'as-is'} onChange={() => update({ promptMode: 'as-is' })} />
                <span>User prompt as-is</span>
              </label>
              <label className={`advanced-radio${promptModeDisabledReason('elaborated') ? ' disabled' : ''}`} title={promptModeDisabledReason('elaborated') ?? ''}>
                <input
                  type="radio"
                  name="prompt-mode"
                  checked={promptMode === 'elaborated'}
                  disabled={promptModeDisabledReason('elaborated') !== null}
                  onChange={() => update({ promptMode: 'elaborated' })}
                />
                <span>Elaborated prompt (same for all)</span>
              </label>
              <label className={`advanced-radio${promptModeDisabledReason('fresh-iteration') ? ' disabled' : ''}`} title={promptModeDisabledReason('fresh-iteration') ?? ''}>
                <input
                  type="radio"
                  name="prompt-mode"
                  checked={promptMode === 'fresh-iteration'}
                  disabled={promptModeDisabledReason('fresh-iteration') !== null}
                  onChange={() => update({ promptMode: 'fresh-iteration' })}
                />
                <span>Fresh elaboration per iteration</span>
              </label>
              <label className={`advanced-radio${promptModeDisabledReason('fresh-task') ? ' disabled' : ''}`} title={promptModeDisabledReason('fresh-task') ?? ''}>
                <input
                  type="radio"
                  name="prompt-mode"
                  checked={promptMode === 'fresh-task'}
                  disabled={promptModeDisabledReason('fresh-task') !== null}
                  onChange={() => update({ promptMode: 'fresh-task' })}
                />
                <span>Fresh elaboration per task</span>
              </label>
            </div>

            {/* Format/Length shape the generated text. They always apply, since
                the Elaborate preview brainstorms regardless of the prompt source. */}
            <div className="advanced-section-label">Prompt format</div>
            <div className="advanced-radio-group">
              {PROMPT_FORMATS.map((format) => (
                <label key={format} className="advanced-radio">
                  <input
                    type="radio"
                    name="prompt-format"
                    checked={promptFormat === format}
                    onChange={() => update({ promptFormat: format })}
                  />
                  <span>{PROMPT_FORMAT_LABELS[format]}</span>
                </label>
              ))}
            </div>

            <div className="advanced-section-label">Prompt length</div>
            <div className="advanced-radio-group">
              {PROMPT_LENGTHS.map((length) => (
                <label key={length} className="advanced-radio">
                  <input
                    type="radio"
                    name="prompt-length"
                    checked={promptLength === length}
                    onChange={() => update({ promptLength: length })}
                  />
                  <span>{PROMPT_LENGTH_LABELS[length]}</span>
                </label>
              ))}
            </div>

            <div className="advanced-section-label">How many iterations</div>
            <input
              className="advanced-count"
              type="number"
              min={1}
              max={MAX_DRAFT_ITERATIONS}
              value={count}
              onChange={(e) => update({ count: normalizeCount(parseInt(e.target.value, 10)) })}
            />
          </div>

          <div className="advanced-pane-footer">
            <div className="advanced-total">
              {totalTasks} task{totalTasks === 1 ? '' : 's'}
            </div>

            {error && <div className="advanced-message advanced-message-error">{error}</div>}

            <button
              className="modal-btn modal-btn-primary advanced-queue-btn"
              onClick={() => void handleQueue()}
              disabled={gates.queue.disabled}
              title={gates.queue.reason ?? ''}
            >
              {activeOperation === 'queue' ? 'Queueing…' : 'Queue Tasks'}
            </button>
          </div>
        </div>
      </div>

      {showHistory && <ElaboratedPromptsModal onClose={() => setShowHistory(false)} />}
    </Modal>
  )
}
