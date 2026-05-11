import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import { useConfirm } from '../context/ConfirmContext'
import {
  useAdvancedPrompting,
  type PromptMode,
} from '../context/AdvancedPromptingContext'
import {
  BACKEND_LABELS,
  CLOUD_BACKEND_IDS_IN_UI_ORDER,
  type BackendId,
  type Elaborator,
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

export function AdvancedPromptingModal({ initialPrompt, onClose }: Props): React.JSX.Element {
  const { settings } = useSettings()
  const confirm = useConfirm()
  const { state, update, appendElaboratedPrompts } = useAdvancedPrompting()
  const {
    seed, selectedElaboratorId, elaborated, override,
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

  const refreshElaborators = useCallback(async (): Promise<void> => {
    const next = await window.electronAPI.listElaborators()
    setElaborators(next)
    // If the currently selected elaborator was deleted or never picked, snap
    // to the first available. Persisted across open/close via context.
    if (selectedElaboratorId && next.some((e) => e.id === selectedElaboratorId)) return
    update({ selectedElaboratorId: next[0]?.id ?? null })
  }, [selectedElaboratorId, update])

  useEffect(() => {
    void refreshElaborators()
  }, [refreshElaborators])

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
  const elaboratorPicked = selectedElaboratorId !== null && elaborators.some((e) => e.id === selectedElaboratorId)
  const elaborateDisabledReason = (() => {
    if (!seed.trim()) return 'Enter a seed prompt above.'
    if (!elaboratorPicked) return 'Pick an elaborator first.'
    return null
  })()

  const promptModeDisabledReason = useCallback((which: PromptMode): string | null => {
    if (which === 'elaborated' && !elaborated.trim()) return 'Run Elaborate first.'
    if ((which === 'fresh-iteration' || which === 'fresh-task') && !elaboratorPicked) return 'Pick an elaborator first.'
    return null
  }, [elaborated, elaboratorPicked])

  // Note: we do NOT auto-reset promptMode when preconditions go away. On
  // modal open, elaboratorPicked transiently flips false before elaborators
  // load, which would silently wipe a persisted fresh-* mode. The radio
  // disabled state and queueDisabledReason already signal a problem.

  const queueDisabledReason = (() => {
    if (totalTasks === 0) return 'Select at least one target.'
    if (promptMode === 'as-is' && !seed.trim()) return 'Seed prompt is empty.'
    if (promptMode === 'elaborated' && !elaborated.trim()) return 'Elaborated prompt is empty.'
    if ((promptMode === 'fresh-iteration' || promptMode === 'fresh-task') && !elaboratorPicked) return 'Pick an elaborator first.'
    if ((promptMode === 'fresh-iteration' || promptMode === 'fresh-task') && !seed.trim()) return 'Enter a seed prompt for elaboration.'
    return null
  })()

  // Run a brainstorm request and stream its progress into the session list.
  // Each turn's prompts append to context.elaboratedPrompts as they arrive, so
  // a mid-run failure still leaves the successful turns in the list. Returns
  // the prompts produced by THIS call (not including prior session prompts).
  const runBrainstorm = useCallback(async (count: number): Promise<string[]> => {
    if (!selectedElaboratorId) throw new Error('Pick an elaborator first.')
    if (!seed.trim()) throw new Error('Seed prompt is empty.')

    const requestId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`

    const unsubscribe = window.electronAPI.onBrainstormProgress(requestId, (event) => {
      appendElaboratedPrompts(event.newPrompts)
      setBrainstormProgress({ done: event.done, total: event.total })
    })

    setBrainstormProgress({ done: 0, total: count })
    try {
      const result = await window.electronAPI.brainstormPrompts({
        requestId,
        elaboratorId: selectedElaboratorId,
        seed,
        count,
        previousPrompts: elaboratedPrompts,
      })
      return result.prompts
    } finally {
      unsubscribe()
      setBrainstormProgress(null)
    }
  }, [selectedElaboratorId, seed, elaboratedPrompts, appendElaboratedPrompts])

  const handleElaborate = useCallback(async (): Promise<void> => {
    if (elaborateDisabledReason) return
    setElaborateBusy(true)
    clearMessage()
    const elaboratorName = elaborators.find((e) => e.id === selectedElaboratorId)?.name ?? null
    void window.electronAPI.appLog('info', 'Advanced: Elaborate clicked', {
      elaborator: elaboratorName,
      seedLen: seed.length,
      previousCount: elaboratedPrompts.length,
    })
    try {
      const newPrompts = await runBrainstorm(1)
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
  }, [elaborateDisabledReason, runBrainstorm, elaborators, selectedElaboratorId, seed, elaboratedPrompts.length, clearMessage, showError, update])

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
      overrideApplied: override.trim().length > 0,
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
      if (prompts.length === 0) throw new Error('No prompts to enqueue.')

      // Apply override at queue time (never during elaboration). Empty-string
      // overrides leave the prompt untouched. Format pulled from
      // brainstorm.templates.override_combine so users can edit it in
      // Elaboration Settings (e.g. for non-English workflows). The fallback
      // is only hit when settings haven't loaded yet — under normal flow the
      // user's persisted template (or the shipped default) is used.
      const trimmedOverride = override.trim()
      const overrideTemplate = ((settings?.brainstorm as Record<string, unknown> | undefined)?.templates as Record<string, unknown> | undefined)?.override_combine as string | undefined
      const finalize = (p: string): string => {
        if (trimmedOverride === '') return p
        const tmpl = overrideTemplate || 'The following describes the desired image, followed by modifications to apply on top of it. Keep all elements of the description unchanged except where the modifications direct otherwise.\n\nDescription:\n{{PROMPT}}\n\nModifications:\n{{OVERRIDE}}'
        return tmpl.split('{{PROMPT}}').join(p).split('{{OVERRIDE}}').join(trimmedOverride)
      }

      // Indexing: prompts in iteration-major order so fresh-task reads naturally
      // ("iter 0 across all models, then iter 1 across all models, ...").
      const promptForUnit = (targetIndex: number, copyIndex: number): string => {
        let raw: string
        if (promptMode === 'as-is' || promptMode === 'elaborated') {
          raw = prompts[0]
        } else if (promptMode === 'fresh-iteration') {
          raw = prompts[copyIndex % prompts.length]
        } else {
          // fresh-task
          const idx = copyIndex * allTargetCount + targetIndex
          raw = prompts[idx % prompts.length]
        }
        return finalize(raw)
      }

      // Modes that share one prompt across all copies of a target can collapse N
      // tasks into a single enqueue with count=copies. The fresh-* modes need
      // distinct prompts per iteration, so each copy is dispatched separately.
      const isBatchable = promptMode === 'as-is' || promptMode === 'elaborated'

      let dispatched = 0
      const proprietaryList = targets.proprietary
      proprietaryList.forEach((backendId, index) => {
        if (isBatchable) {
          const p = promptForUnit(index, 0)
          window.dispatchEvent(new CustomEvent('enqueue-single', { detail: { backend: backendId, prompt: p, count: copies } }))
          dispatched += copies
        } else {
          for (let c = 0; c < copies; c++) {
            const p = promptForUnit(index, c)
            window.dispatchEvent(new CustomEvent('enqueue-single', { detail: { backend: backendId, prompt: p, count: 1 } }))
            dispatched++
          }
        }
      })

      for (let i = 0; i < targets.dt.length; i++) {
        const modelFile = targets.dt[i]
        const targetIndex = proprietaryList.length + i
        const { params } = await buildDtParams(modelFile)
        if (isBatchable) {
          const p = promptForUnit(targetIndex, 0)
          await window.electronAPI.enqueue({
            prompt: p,
            backend: 'drawthings',
            model: modelFile,
            params: params as unknown as Record<string, unknown>,
            count: copies,
          })
          dispatched += copies
        } else {
          for (let c = 0; c < copies; c++) {
            const p = promptForUnit(targetIndex, c)
            await window.electronAPI.enqueue({
              prompt: p,
              backend: 'drawthings',
              model: modelFile,
              params: params as unknown as Record<string, unknown>,
              count: 1,
            })
            dispatched++
          }
        }
      }

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
    seed, elaborated, override, runBrainstorm, buildDtParams, elaboratedPrompts.length, settings,
    clearMessage, showInfo, showError,
  ])

  // Esc / outside-click / X all route through here. The only time we ask the
  // user to confirm is while a long-running operation is in flight, since
  // state itself is session-scoped (closing is otherwise non-destructive).
  const handleRequestClose = useCallback(async (): Promise<void> => {
    if (busy) {
      const ok = await confirm({
        title: 'Operation in progress',
        message: 'An elaboration or queue operation is still running. Close anyway? Prompts produced after close will not be added to the session list.',
        confirmLabel: 'Close',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }, [busy, confirm, onClose])

  return (
    <Modal title="Advanced Prompting" className="advanced-modal-box" onClose={() => void handleRequestClose()}>
      <div className={`advanced-body${isMacPlatform ? '' : ' advanced-body-no-dt'}`}>
        <div className="advanced-pane">
          <div className="advanced-pane-title">Prompt</div>
          <textarea
            className="advanced-seed"
            rows={3}
            placeholder="Seed prompt or full prompt..."
            value={seed}
            onChange={(e) => update({ seed: e.target.value })}
          />
          <div className="advanced-elaborator-list">
            {elaborators.length === 0 ? (
              <div className="advanced-empty">No elaborators. Open Elaborators from the menu.</div>
            ) : (
              elaborators.map((el) => (
                <label key={el.id} className={`advanced-elab-row${selectedElaboratorId === el.id ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="advanced-elaborator"
                    checked={selectedElaboratorId === el.id}
                    onChange={() => update({ selectedElaboratorId: el.id })}
                  />
                  <div className="advanced-elab-text">
                    <div className="advanced-elab-name">{el.name}</div>
                    {el.description && <div className="advanced-elab-desc">{el.description}</div>}
                  </div>
                </label>
              ))
            )}
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
          <div className="advanced-section-label">Override</div>
          <textarea
            className="advanced-override"
            rows={3}
            placeholder="Optional constraint applied to every elaborated prompt."
            value={override}
            onChange={(e) => update({ override: e.target.value })}
          />
        </div>

        <div className="advanced-pane">
          <div className="advanced-pane-title">Targets</div>
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

        <div className="advanced-pane">
          <div className="advanced-pane-title">Execution</div>

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

      {showHistory && <ElaboratedPromptsModal onClose={() => setShowHistory(false)} />}
    </Modal>
  )
}
