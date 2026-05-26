import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import { useEnqueueConfigs } from '../context/EnqueueConfigContext'
import {
  useAdvancedPrompting,
  type PromptMode,
} from '../context/AdvancedPromptingContext'
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
import { ElaboratedPromptsModal } from './ElaboratedPromptsModal'
import './AdvancedPromptingModal.css'

interface Props {
  initialPrompt?: string
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

export function AdvancedPromptingModal({ initialPrompt, onClose }: Props): React.JSX.Element {
  const { settings } = useSettings()
  const confirm = useConfirm()
  const { snapshots } = useEnqueueConfigs()
  const { state, update, appendElaboratedPrompts } = useAdvancedPrompting()
  const {
    seed, selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId, elaborated,
    selectedProprietary, selectedDtFiles, promptMode, targetScope, count, elaboratedPrompts,
  } = state

  // Pre-fill the seed from the main prompt on first open within a session,
  // and only when the user has nothing typed yet. Once the user has anything
  // in the seed, we leave it alone — including across modal open/close — so
  // their work is preserved when reopening within the same session.
  useEffect(() => {
    if (!seed && initialPrompt && initialPrompt.trim()) {
      update({ seed: initialPrompt })
    }
    // Intentionally only on mount: subsequent prop changes shouldn't clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [elaborators, setElaborators] = useState<Elaborator[]>([])
  const [elaborateBusy, setElaborateBusy] = useState(false)
  const [brainstormProgress, setBrainstormProgress] = useState<{ done: number; total: number } | null>(null)
  const [downloadedDtModels, setDownloadedDtModels] = useState<LocalModelInfo[]>([])
  const [queueBusy, setQueueBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'info' | 'error'>('info')
  const [showHistory, setShowHistory] = useState(false)
  const elaboratorRowRefs = useRef(new Map<string, HTMLLabelElement>())
  // Set to true when the user confirms closing mid-operation, so that any still-
  // in-flight async continuations know to discard their results rather than
  // append prompts or enqueue tasks.
  const cancelledRef = useRef(false)

  const busy = elaborateBusy || queueBusy

  const showError = useCallback((text: string): void => {
    setMessage(text)
    setMessageType('error')
  }, [])
  const showInfo = useCallback((text: string): void => {
    setMessage(text)
    setMessageType('info')
  }, [])
  const clearMessage = useCallback((): void => {
    setMessage('')
    setMessageType('info')
  }, [])

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

  const drawThingsFallbacks = useMemo(() => {
    const params = (
      (settings?.image_backends as Record<string, Record<string, unknown>> | undefined)?.drawthings
        ?.default_params as Record<string, unknown> | undefined
    ) ?? {}
    return {
      width: (params.fallback_width as number | undefined) ?? 1024,
      height: (params.fallback_height as number | undefined) ?? 1024,
      steps: (params.fallback_steps as number | undefined) ?? 4,
      guidance: (params.fallback_guidance as number | undefined) ?? 1,
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
  const contentElaboratorPicked = selectedContentElaboratorId !== null && elaboratorsByKind.content.some((e) => e.id === selectedContentElaboratorId)
  const compositionElaboratorPicked = selectedCompositionElaboratorId !== null && elaboratorsByKind.composition.some((e) => e.id === selectedCompositionElaboratorId)
  const styleElaboratorPicked = selectedStyleElaboratorId !== null && elaboratorsByKind.style.some((e) => e.id === selectedStyleElaboratorId)
  const missingElaboratorKind = !contentElaboratorPicked
    ? 'content'
    : !compositionElaboratorPicked
      ? 'composition'
      : !styleElaboratorPicked
        ? 'style'
        : null
  const elaborateDisabledReason = (() => {
    if (!seed.trim()) return 'Enter a seed prompt above.'
    if (missingElaboratorKind) return `Pick a ${ELABORATOR_KIND_LABELS[missingElaboratorKind].toLowerCase()} elaborator first.`
    return null
  })()

  const promptModeDisabledReason = useCallback((which: PromptMode): string | null => {
    if (which === 'elaborated' && !elaborated.trim()) return 'Run Elaborate first.'
    if ((which === 'fresh-iteration' || which === 'fresh-task') && missingElaboratorKind) {
      return `Pick a ${ELABORATOR_KIND_LABELS[missingElaboratorKind].toLowerCase()} elaborator first.`
    }
    return null
  }, [elaborated, missingElaboratorKind])

  // Note: we do NOT auto-reset promptMode when preconditions go away. On
  // modal open, one or more category selections can transiently read as
  // missing before elaborators load, which would silently wipe a persisted
  // fresh-* mode. The radio disabled state and queueDisabledReason already
  // signal a problem.

  const queueDisabledReason = (() => {
    if (totalTasks === 0) return 'Select at least one target.'
    if (promptMode === 'as-is' && !seed.trim()) return 'Seed prompt is empty.'
    if (promptMode === 'elaborated' && !elaborated.trim()) return 'Elaborated prompt is empty.'
    if ((promptMode === 'fresh-iteration' || promptMode === 'fresh-task') && missingElaboratorKind) {
      return `Pick a ${ELABORATOR_KIND_LABELS[missingElaboratorKind].toLowerCase()} elaborator first.`
    }
    if ((promptMode === 'fresh-iteration' || promptMode === 'fresh-task') && !seed.trim()) return 'Enter a seed prompt for elaboration.'
    return null
  })()

  // Run a brainstorm request and stream its progress into the session list.
  // Each turn's prompts append to context.elaboratedPrompts as they arrive, so
  // a mid-run failure still leaves the successful turns in the list. Returns
  // the prompts produced by THIS call (not including prior session prompts).
  const runBrainstorm = useCallback(async (count: number): Promise<string[]> => {
    if (!selectedContentElaboratorId || !selectedCompositionElaboratorId || !selectedStyleElaboratorId) {
      throw new Error('Pick content, composition, and style elaborators first.')
    }
    if (!seed.trim()) throw new Error('Seed prompt is empty.')

    const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`

    const unsubscribe = window.electronAPI.onBrainstormProgress(requestId, (event) => {
      if (!cancelledRef.current) {
        appendElaboratedPrompts(event.newPrompts)
      }
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
      })
      return result.prompts
    } finally {
      unsubscribe()
      setBrainstormProgress(null)
    }
  }, [selectedContentElaboratorId, selectedCompositionElaboratorId, selectedStyleElaboratorId, seed, elaboratedPrompts, appendElaboratedPrompts])

  const handleElaborate = useCallback(async (): Promise<void> => {
    if (elaborateDisabledReason) return
    setElaborateBusy(true)
    clearMessage()
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
        showError('Text AI returned no prompt.')
        return
      }
      update({ elaborated: first, promptMode: 'elaborated' })
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      setElaborateBusy(false)
    }
  }, [
    elaborateDisabledReason, runBrainstorm, elaboratedPrompts.length, clearMessage, showError, update,
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
    if (queueDisabledReason) return
    setQueueBusy(true)
    clearMessage()
    const targets = effectiveTargets
    const copies = Math.max(1, count)
    const allTargetCount = targetCount
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
      let prompts: string[] = []
      if (promptMode === 'as-is') {
        prompts = [seed.trim()]
      } else if (promptMode === 'elaborated') {
        prompts = [elaborated.trim()]
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

      await window.electronAPI.enqueueBatch(units)
      const dispatched = units.length

      showInfo(`Queued ${dispatched} task${dispatched === 1 ? '' : 's'}.`)
      void window.electronAPI.appLog('info', 'Advanced: Queue dispatched', {
        mode: promptMode,
        dispatched,
      })
      // Modal stays open by design — the user may want to queue more rounds
      // using the now-grown session list as previousPrompts.
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      setQueueBusy(false)
    }
  }, [
    queueDisabledReason, effectiveTargets, count, targetCount, promptMode,
    seed, elaborated, runBrainstorm, buildDtParams, elaboratedPrompts.length,
    snapshots, clearMessage, showInfo, showError,
  ])

  // Esc / outside-click / X all route through here. The only time we ask the
  // user to confirm is while a long-running operation is in flight, since
  // state itself is session-scoped (closing is otherwise non-destructive).
  const handleRequestClose = useCallback(async (): Promise<void> => {
    if (busy) {
      const ok = await confirm({
        title: 'Operation in progress',
        message: 'An elaboration or queue operation is still running. Close anyway? Any results still being generated will be discarded.',
        confirmLabel: 'Close',
        danger: true,
      })
      if (!ok) return
      cancelledRef.current = true
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
            <div className="advanced-empty">No {kind} elaborators.</div>
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
              rows={3}
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
                disabled={elaborateBusy || elaborateDisabledReason !== null}
                title={elaborateDisabledReason ?? 'Generate one elaborated prompt'}
              >
                {elaborateBusy
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

            <div className="advanced-section-label">How many iterations</div>
            <input
              className="advanced-count"
              type="number"
              min={1}
              max={9999}
              value={count}
              onChange={(e) => update({ count: Math.max(1, parseInt(e.target.value) || 1) })}
            />
          </div>

          <div className="advanced-pane-footer">
            <div className="advanced-total">
              {totalTasks} task{totalTasks === 1 ? '' : 's'}
            </div>

            {message && <div className={`advanced-message advanced-message-${messageType}`}>{message}</div>}

            <button
              className="modal-btn modal-btn-primary advanced-queue-btn"
              onClick={() => void handleQueue()}
              disabled={queueBusy || queueDisabledReason !== null}
              title={queueDisabledReason ?? ''}
            >
              {queueBusy
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
