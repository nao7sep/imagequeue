import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { multiline } from '../utils/textCleanup'
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
  type EnqueueBatchUnit,
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
  type ActiveOperation,
} from '../utils/advancedPromptingGates'
import { ElaboratedPromptsModal } from './ElaboratedPromptsModal'
import './AdvancedPromptingModal.css'

interface Props {
  onClose: () => void
}

interface DtParams {
  width: number
  height: number
  steps: number
  guidance: number
  seed?: number
  negativePrompt?: string
}

const isMacPlatform = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
const ELABORATOR_KINDS: ElaboratorKind[] = ['content', 'composition', 'style']

function groupElaborators(items: Elaborator[]): Record<ElaboratorKind, Elaborator[]> {
  return {
    content: items.filter((item) => item.kind === 'content'),
    composition: items.filter((item) => item.kind === 'composition'),
    style: items.filter((item) => item.kind === 'style'),
  }
}

export function AdvancedPromptingModal({ onClose }: Props): React.JSX.Element {
  const { settings } = useSettings()
  const confirm = useConfirm()
  const { snapshots } = useEnqueueConfigs()
  const { state, update, appendElaboratedPrompts } = useSessionDraft()
  const {
    prompt, seed, selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId, elaborated,
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
  // Elaborate and Queue are mutually exclusive: both drive the single brainstorm
  // engine, so at most one runs at a time. One value (not a boolean per action)
  // means there is no second flag a control can read by mistake.
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null)
  const [brainstormProgress, setBrainstormProgress] = useState<{ done: number; total: number } | null>(null)
  const [downloadedDtModels, setDownloadedDtModels] = useState<LocalModelInfo[]>([])
  // Only errors surface in the modal: a successful queue closes it (the now-
  // populated queue columns are the confirmation), so there is no info state.
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const elaboratorRowRefs = useRef(new Map<string, HTMLLabelElement>())
  // Set to true when the user confirms closing mid-operation, so that any still-
  // in-flight async continuations know to discard their results rather than
  // append prompts or enqueue tasks.
  const cancelledRef = useRef(false)
  // The brainstorm requestId of the run in flight, so a deliberate close can
  // tell the main process to stop generating. Null when no brainstorm is running.
  const activeRequestIdRef = useRef<string | null>(null)

  const elaboratorsByKind = useMemo(() => groupElaborators(elaborators), [elaborators])

  const refreshElaborators = useCallback(async (): Promise<void> => {
    const next = await window.electronAPI.listElaborators()
    setElaborators(next)
    const grouped = groupElaborators(next)
    update({
      selectedContentElaboratorId: grouped.content.some((e) => e.id === selectedContentElaboratorId)
        ? selectedContentElaboratorId
        : grouped.content[0]?.id ?? null,
      selectedCompositionElaboratorId: grouped.composition.some((e) => e.id === selectedCompositionElaboratorId)
        ? selectedCompositionElaboratorId
        : grouped.composition[0]?.id ?? null,
      selectedStyleElaboratorId: grouped.style.some((e) => e.id === selectedStyleElaboratorId)
        ? selectedStyleElaboratorId
        : grouped.style[0]?.id ?? null,
    })
  }, [selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId, update])

  useEffect(() => {
    void refreshElaborators()
  }, [refreshElaborators])

  useEffect(() => {
    for (const id of [selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId]) {
      if (!id) continue
      elaboratorRowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId, elaborators])

  useEffect(() => {
    if (!isMacPlatform) {
      setDownloadedDtModels([])
      return
    }
    window.electronAPI.localListDownloadedModels().then((list) => setDownloadedDtModels(sortLocalModels(list)))
  }, [])

  const proprietaryApiKeyByBackend = useMemo<Record<string, boolean>>(() => {
    const result: Record<string, boolean> = {}
    const backends = (settings?.image_backends ?? {}) as Record<string, Record<string, unknown>>
    for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      const key = backends[id]?.api_key
      result[id] = typeof key === 'string' && key.trim().length > 0
    }
    return result
  }, [settings])

  // Draw Things fallback params read straight from config: config-store's
  // deepMergeDefaults guarantees these keys exist, so the defaults live in one
  // place (config/defaults.ts) rather than being re-hardcoded here. Null only in
  // the brief window before settings load — buildDtParams halts in that case
  // instead of inventing values.
  const drawThingsFallbacks = useMemo(() => {
    const params = (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
      ?.default_params as Record<string, unknown> | undefined
    if (!params) return null
    return {
      width: params.fallback_width as number,
      height: params.fallback_height as number,
      steps: params.fallback_steps as number,
      guidance: params.fallback_guidance as number,
      seed: params.seed == null ? null : Number(params.seed),
      negativePrompt: (params.fallback_negative_prompt as string | undefined) ?? '',
    }
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
    const proprietary: BackendId[] = []
    let dt: string[] = []

    if (targetScope === 'selected') {
      for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
        if (selectedProprietary[id] && proprietaryApiKeyByBackend[id]) proprietary.push(id)
      }
      const selectedSet = new Set(selectedDtFiles)
      dt = downloadedDtModels
        .map((m) => m.file)
        .filter((f) => selectedSet.has(f))
    } else if (targetScope === 'all-proprietary') {
      for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
        if (proprietaryApiKeyByBackend[id]) proprietary.push(id)
      }
    } else if (targetScope === 'all-drawthings') {
      dt = downloadedDtModels.map((m) => m.file)
    } else {
      for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
        if (proprietaryApiKeyByBackend[id]) proprietary.push(id)
      }
      dt = downloadedDtModels.map((m) => m.file)
    }
    return { proprietary, dt }
  }, [targetScope, selectedProprietary, selectedDtFiles, downloadedDtModels, proprietaryApiKeyByBackend])

  const targetCount = effectiveTargets.proprietary.length + effectiveTargets.dt.length
  const totalTasks = Math.max(0, targetCount * Math.max(1, count))
  const picks = {
    content: selectedContentElaboratorId !== null && elaboratorsByKind.content.some((e) => e.id === selectedContentElaboratorId),
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
  const busy = gates.busy

  // Note: we do NOT auto-reset promptMode when preconditions go away. On
  // modal open, one or more category selections can transiently read as
  // missing before elaborators load, which would silently wipe a persisted
  // fresh-* mode. The radio disabled state and the queue gate already signal a
  // problem.
  const promptModeDisabledReason = (which: PromptMode): string | null =>
    promptModeDisabledReasonFor(which, elaborated.trim().length > 0, gates.missingElaboratorKind)

  // Run a brainstorm request and return the prompts it produced (not including
  // prior session prompts). Prompts are NOT written to the session history here
  // — the caller persists them only after committing the run (queueing the
  // tasks, or accepting the single Elaborate result), so an aborted or failed
  // run leaves nothing behind. Progress events drive only the live counter.
  const runBrainstorm = useCallback(async (count: number): Promise<string[]> => {
    if (!selectedContentElaboratorId || !selectedCompositionElaboratorId || !selectedStyleElaboratorId) {
      throw new Error('Pick content, composition, and style elaborators first.')
    }
    if (!seed.trim()) throw new Error('Seed prompt is empty.')

    const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`
    activeRequestIdRef.current = requestId

    const unsubscribe = window.electronAPI.onBrainstormProgress(requestId, (event) => {
      setBrainstormProgress({ done: event.done, total: event.total })
    })

    setBrainstormProgress({ done: 0, total: count })
    try {
      const result = await window.electronAPI.brainstormPrompts({
        requestId,
        contentElaboratorId: selectedContentElaboratorId,
        compositionElaboratorId: selectedCompositionElaboratorId,
        styleElaboratorId: selectedStyleElaboratorId,
        seed,
        count,
        previousPrompts: elaboratedPrompts,
        format: promptFormat,
        length: promptLength,
      })
      return result.prompts
    } finally {
      unsubscribe()
      setBrainstormProgress(null)
      activeRequestIdRef.current = null
    }
  }, [selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId, seed, elaboratedPrompts, promptFormat, promptLength])

  const handleElaborate = useCallback(async (): Promise<void> => {
    if (gates.elaborate.disabled) return
    setActiveOperation('elaborate')
    setError('')
    void window.electronAPI.appLog('info', 'Advanced: Elaborate clicked', {
      contentElaborator: elaboratorsByKind.content.find((e) => e.id === selectedContentElaboratorId)?.name ?? null,
      compositionElaborator: elaboratorsByKind.composition.find((e) => e.id === selectedCompositionElaboratorId)?.name ?? null,
      styleElaborator: elaboratorsByKind.style.find((e) => e.id === selectedStyleElaboratorId)?.name ?? null,
      seedLen: seed.length,
      previousCount: elaboratedPrompts.length,
    })
    try {
      const newPrompts = await runBrainstorm(1)
      if (cancelledRef.current) return
      const first = newPrompts[0]
      if (!first) {
        setError('Text AI returned no prompt.')
        return
      }
      // Elaborate is a preview: fill the elaborated box and record the result in
      // the session history (it feeds future runs' "avoid repeats" context), but
      // leave the user's prompt-source selection alone. Switching it here would
      // hijack a deliberate choice just because they wanted to see one sample.
      update({ elaborated: first })
      appendElaboratedPrompts([first])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActiveOperation(null)
    }
  }, [
    gates.elaborate.disabled, runBrainstorm, elaboratedPrompts.length, update, appendElaboratedPrompts,
    elaboratorsByKind, selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId, seed,
  ])

  const buildDtParams = useCallback(async (modelFile: string): Promise<{ model: string; params: DtParams }> => {
    const saved = await window.electronAPI.dtGetModelParams(modelFile)
    if (saved) {
      const params: DtParams = {
        width: saved.width,
        height: saved.height,
        steps: saved.steps,
        guidance: saved.guidance,
      }
      const seedNum = saved.seed ? parseInt(saved.seed) : NaN
      if (!Number.isNaN(seedNum) && seedNum > 0) params.seed = seedNum
      if (saved.negativePrompt) params.negativePrompt = saved.negativePrompt
      return { model: modelFile, params }
    }
    const rec = await window.electronAPI.resolveRecommendation(modelFile)
    if (!drawThingsFallbacks) {
      throw new Error('Draw Things settings are still loading — try again in a moment.')
    }
    const params: DtParams = {
      width: rec?.width ?? drawThingsFallbacks.width,
      height: rec?.height ?? drawThingsFallbacks.height,
      steps: rec?.steps ?? drawThingsFallbacks.steps,
      guidance: rec?.guidance ?? drawThingsFallbacks.guidance,
    }
    const fallbackSeed = drawThingsFallbacks.seed
    if (fallbackSeed != null && fallbackSeed > 0) params.seed = fallbackSeed
    const neg = rec?.negativePrompt ?? drawThingsFallbacks.negativePrompt
    if (neg) params.negativePrompt = neg
    return { model: modelFile, params }
  }, [drawThingsFallbacks])

  const handleQueue = useCallback(async (): Promise<void> => {
    if (gates.queue.disabled) return
    setActiveOperation('queue')
    setError('')
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
      previousCount: elaboratedPrompts.length,
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
      let prompts: string[] = []
      if (promptMode === 'as-is') {
        // Reused prompt bodies — clean as multiline at this commit point.
        prompts = [multiline(seed)]
      } else if (promptMode === 'elaborated') {
        prompts = [multiline(elaborated)]
      } else if (promptMode === 'fresh-iteration') {
        prompts = await runBrainstorm(copies)
      } else {
        // fresh-task
        const needed = allTargetCount * copies
        prompts = await runBrainstorm(needed)
      }
      if (cancelledRef.current) return
      if (prompts.length === 0) throw new Error('No prompts to enqueue.')

      // Indexing: prompts in iteration-major order so fresh-task reads naturally
      // ("iter 0 across all models, then iter 1 across all models, ...").
      const promptForUnit = (targetIndex: number, copyIndex: number): string => {
        if (promptMode === 'as-is' || promptMode === 'elaborated') {
          return prompts[0]
        }
        if (promptMode === 'fresh-iteration') {
          return prompts[copyIndex % prompts.length]
        }
        // fresh-task
        const idx = copyIndex * allTargetCount + targetIndex
        return prompts[idx % prompts.length]
      }

      const proprietaryUnits = targets.proprietary.map((backendId) => {
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

      const units: EnqueueBatchUnit[] = []
      for (let c = 0; c < copies; c++) {
        proprietaryUnits.forEach((unit, index) => {
          units.push({
            prompt: promptForUnit(index, c),
            backend: unit.backend,
            model: unit.model,
            params: unit.params,
          })
        })
        dtUnits.forEach((unit, index) => {
          units.push({
            prompt: promptForUnit(proprietaryUnits.length + index, c),
            backend: 'drawthings',
            model: unit.model,
            params: unit.params as unknown as Record<string, unknown>,
          })
        })
      }

      // Re-check after the awaits above (snapshot reads, DT param resolution):
      // a deliberate close could have landed mid-build, and nothing should be
      // queued then. No await sits between this gate and the enqueue, so it
      // can't be raced.
      if (cancelledRef.current) return
      await window.electronAPI.enqueueBatch(units)

      // Commit: the tasks now exist, so record the freshly brainstormed prompts
      // in the session history. A run that was cancelled or failed never reaches
      // this point, so it leaves no orphan entries.
      if (brainstormed) appendElaboratedPrompts(prompts)
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
    seed, elaborated, runBrainstorm, buildDtParams, elaboratedPrompts.length,
    snapshots, appendElaboratedPrompts, onClose,
  ])

  // Esc / outside-click / X all route through here. The only time we ask the
  // user to confirm is while a long-running operation is in flight, since
  // state itself is session-scoped (closing is otherwise non-destructive).
  const handleRequestClose = useCallback(async (): Promise<void> => {
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
      const requestId = activeRequestIdRef.current
      if (requestId) void window.electronAPI.cancelBrainstorm(requestId)
    }
    onClose()
  }, [busy, confirm, onClose])

  const selectElaborator = useCallback((kind: ElaboratorKind, id: string): void => {
    switch (kind) {
      case 'content':
        update({ selectedContentElaboratorId: id })
        return
      case 'composition':
        update({ selectedCompositionElaboratorId: id })
        return
      case 'style':
        update({ selectedStyleElaboratorId: id })
        return
    }
  }, [update])

  const selectedElaboratorIds: Record<ElaboratorKind, string | null> = {
    content: selectedContentElaboratorId,
    composition: selectedCompositionElaboratorId,
    style: selectedStyleElaboratorId,
  }

  const renderElaboratorColumn = (kind: ElaboratorKind): React.JSX.Element => {
    const items = elaboratorsByKind[kind]
    return (
      <div className="advanced-elaborator-column" key={kind}>
        <div className="advanced-elaborator-column-title">{ELABORATOR_KIND_LABELS[kind]}</div>
        <div className="advanced-elaborator-column-list">
          {items.length === 0 ? (
            <div className="advanced-empty">No {ELABORATOR_KIND_LABELS[kind].toLowerCase()} elaborators.</div>
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
                {activeOperation === 'elaborate'
                  ? (brainstormProgress && brainstormProgress.total > 1
                      ? `Elaborating ${brainstormProgress.done} / ${brainstormProgress.total}…`
                      : 'Elaborating…')
                  : 'Elaborate'}
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
                    {!hasKey && <span className="advanced-target-hint">no API key</span>}
                  </label>
                )
              })}
              {isMacPlatform && (
                <>
                  <div className="advanced-targets-group-title">Draw Things</div>
                  {downloadedDtModels.length === 0 ? (
                    <div className="advanced-empty">No models downloaded.</div>
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
              {activeOperation === 'queue'
                ? (brainstormProgress
                    ? `Generating ${brainstormProgress.done} / ${brainstormProgress.total}…`
                    : 'Queueing…')
                : 'Queue Tasks'}
            </button>
          </div>
        </div>
      </div>

      {showHistory && <ElaboratedPromptsModal onClose={() => setShowHistory(false)} />}
    </Modal>
  )
}
