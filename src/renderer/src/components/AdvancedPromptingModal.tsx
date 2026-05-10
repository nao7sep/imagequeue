import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useSettings } from '../context/SettingsContext'
import {
  BACKEND_LABELS,
  CLOUD_BACKEND_IDS_IN_UI_ORDER,
  type BackendId,
  type Elaborator,
  type LocalModelInfo,
} from '../../../shared/types'
import { localModelName, sortLocalModels } from '../utils/localModels'
import './AdvancedPromptingModal.css'

interface Props {
  initialPrompt?: string
  onClose: () => void
}

type PromptMode = 'as-is' | 'elaborated' | 'fresh-iteration' | 'fresh-task'
type TargetScope = 'selected' | 'all-proprietary' | 'all-drawthings' | 'all'

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
  const [seed, setSeed] = useState(initialPrompt ?? '')
  const [elaborators, setElaborators] = useState<Elaborator[]>([])
  const [selectedElaboratorId, setSelectedElaboratorId] = useState<string | null>(null)
  const [elaborated, setElaborated] = useState('')
  const [override, setOverride] = useState('')
  const [elaborateBusy, setElaborateBusy] = useState(false)

  const [downloadedDtModels, setDownloadedDtModels] = useState<LocalModelInfo[]>([])
  const [selectedProprietary, setSelectedProprietary] = useState<Record<BackendId, boolean>>(() => ({
    openai: false, imagen: false, nanobanana: false, grok: false, flux: false, drawthings: false,
  }))
  const [selectedDtFiles, setSelectedDtFiles] = useState<Set<string>>(new Set())

  const [promptMode, setPromptMode] = useState<PromptMode>('as-is')
  const [targetScope, setTargetScope] = useState<TargetScope>('selected')
  const [count, setCount] = useState(1)

  const [queueBusy, setQueueBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refreshElaborators = useCallback(async (): Promise<void> => {
    const next = await window.electronAPI.listElaborators()
    setElaborators(next)
    setSelectedElaboratorId((current) => {
      if (current && next.some((e) => e.id === current)) return current
      return next[0]?.id ?? null
    })
  }, [])

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
    setSelectedProprietary((cur) => ({ ...cur, [id]: !cur[id] }))
  }

  const toggleDtFile = (file: string): void => {
    setSelectedDtFiles((cur) => {
      const next = new Set(cur)
      if (next.has(file)) next.delete(file); else next.add(file)
      return next
    })
  }

  const effectiveTargets = useMemo(() => {
    const proprietary: BackendId[] = []
    let dt: string[] = []

    if (targetScope === 'selected') {
      for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
        if (selectedProprietary[id] && proprietaryApiKeyByBackend[id]) proprietary.push(id)
      }
      dt = downloadedDtModels
        .map((m) => m.file)
        .filter((f) => selectedDtFiles.has(f))
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

  const promptModeDisabledReason = (which: PromptMode): string | null => {
    if (which === 'elaborated' && !elaborated.trim()) return 'Run Elaborate first.'
    if ((which === 'fresh-iteration' || which === 'fresh-task') && !elaboratorPicked) return 'Pick an elaborator first.'
    return null
  }

  // If the chosen prompt mode becomes unavailable, fall back to as-is.
  useEffect(() => {
    if (promptModeDisabledReason(promptMode)) setPromptMode('as-is')
  }, [elaborated, elaboratorPicked]) // eslint-disable-line react-hooks/exhaustive-deps

  const queueDisabledReason = (() => {
    if (totalTasks === 0) return 'Select at least one target.'
    if (promptMode === 'as-is' && !seed.trim()) return 'Seed prompt is empty.'
    if (promptMode === 'elaborated' && !elaborated.trim()) return 'Elaborated prompt is empty.'
    if ((promptMode === 'fresh-iteration' || promptMode === 'fresh-task') && !elaboratorPicked) return 'Pick an elaborator first.'
    if ((promptMode === 'fresh-iteration' || promptMode === 'fresh-task') && !seed.trim()) return 'Enter a seed prompt for elaboration.'
    return null
  })()

  const handleElaborate = useCallback(async (): Promise<void> => {
    if (elaborateDisabledReason || !selectedElaboratorId) return
    setElaborateBusy(true)
    setMessage('')
    try {
      const result = await window.electronAPI.brainstormPrompts(selectedElaboratorId, seed, 1)
      const first = result.prompts[0]
      if (!first) {
        setMessage('Text AI returned no prompt.')
        return
      }
      setElaborated(first)
      setPromptMode('elaborated')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setElaborateBusy(false)
    }
  }, [elaborateDisabledReason, selectedElaboratorId, seed])

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
    setMessage('')
    try {
      const targets = effectiveTargets
      const copies = Math.max(1, count)
      const allTargetCount = targetCount

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
        if (!selectedElaboratorId) throw new Error('Pick an elaborator first.')
        const result = await window.electronAPI.brainstormPrompts(selectedElaboratorId, seed, copies)
        prompts = result.prompts
      } else {
        // fresh-task
        if (!selectedElaboratorId) throw new Error('Pick an elaborator first.')
        const needed = allTargetCount * copies
        const result = await window.electronAPI.brainstormPrompts(selectedElaboratorId, seed, needed)
        prompts = result.prompts
      }
      if (prompts.length === 0) throw new Error('No prompts to enqueue.')

      // Indexing: prompts in iteration-major order so fresh-task reads naturally
      // ("iter 0 across all models, then iter 1 across all models, ...").
      const promptForUnit = (targetIndex: number, copyIndex: number): string => {
        if (promptMode === 'as-is' || promptMode === 'elaborated') return prompts[0]
        if (promptMode === 'fresh-iteration') return prompts[copyIndex % prompts.length]
        // fresh-task
        const idx = copyIndex * allTargetCount + targetIndex
        return prompts[idx % prompts.length]
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

      setMessage(`Queued ${dispatched} task${dispatched === 1 ? '' : 's'}.`)
      setTimeout(() => onClose(), 600)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setQueueBusy(false)
    }
  }, [
    queueDisabledReason, effectiveTargets, count, targetCount, promptMode,
    seed, elaborated, selectedElaboratorId, buildDtParams, onClose,
  ])

  return (
    <Modal title="Advanced Prompting" className="advanced-modal-box" onClose={onClose}>
      <div className={`advanced-body${isMacPlatform ? '' : ' advanced-body-no-dt'}`}>
        <div className="advanced-pane">
          <div className="advanced-pane-title">Prompt</div>
          <textarea
            className="advanced-seed"
            rows={3}
            placeholder="Seed prompt or full prompt..."
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
          <div className="advanced-elaborator-list">
            {elaborators.length === 0 ? (
              <div className="advanced-empty">No elaborators. Open Manage…</div>
            ) : (
              elaborators.map((el) => (
                <label key={el.id} className={`advanced-elab-row${selectedElaboratorId === el.id ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="advanced-elaborator"
                    checked={selectedElaboratorId === el.id}
                    onChange={() => setSelectedElaboratorId(el.id)}
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
              {elaborateBusy ? 'Elaborating…' : 'Elaborate'}
            </button>
          </div>
          <textarea
            className="advanced-elaborated"
            placeholder="Elaborated prompt will appear here. You can edit before queueing."
            value={elaborated}
            onChange={(e) => setElaborated(e.target.value)}
          />
          <div className="advanced-section-label">Override</div>
          <textarea
            className="advanced-override"
            rows={3}
            placeholder="Optional constraint applied to every elaborated prompt."
            value={override}
            onChange={(e) => setOverride(e.target.value)}
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
                        checked={selectedDtFiles.has(m.file)}
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
              <input type="radio" name="prompt-mode" checked={promptMode === 'as-is'} onChange={() => setPromptMode('as-is')} />
              <span>User prompt as-is</span>
            </label>
            <label className={`advanced-radio${promptModeDisabledReason('elaborated') ? ' disabled' : ''}`} title={promptModeDisabledReason('elaborated') ?? ''}>
              <input
                type="radio"
                name="prompt-mode"
                checked={promptMode === 'elaborated'}
                disabled={promptModeDisabledReason('elaborated') !== null}
                onChange={() => setPromptMode('elaborated')}
              />
              <span>Elaborated prompt (same for all)</span>
            </label>
            <label className={`advanced-radio${promptModeDisabledReason('fresh-iteration') ? ' disabled' : ''}`} title={promptModeDisabledReason('fresh-iteration') ?? ''}>
              <input
                type="radio"
                name="prompt-mode"
                checked={promptMode === 'fresh-iteration'}
                disabled={promptModeDisabledReason('fresh-iteration') !== null}
                onChange={() => setPromptMode('fresh-iteration')}
              />
              <span>Fresh elaboration per iteration</span>
            </label>
            <label className={`advanced-radio${promptModeDisabledReason('fresh-task') ? ' disabled' : ''}`} title={promptModeDisabledReason('fresh-task') ?? ''}>
              <input
                type="radio"
                name="prompt-mode"
                checked={promptMode === 'fresh-task'}
                disabled={promptModeDisabledReason('fresh-task') !== null}
                onChange={() => setPromptMode('fresh-task')}
              />
              <span>Fresh elaboration per task</span>
            </label>
          </div>

          <div className="advanced-section-label">Target scope</div>
          <div className="advanced-radio-group">
            <label className="advanced-radio">
              <input type="radio" name="target-scope" checked={targetScope === 'selected'} onChange={() => setTargetScope('selected')} />
              <span>Selected</span>
            </label>
            {isMacPlatform && (
              <>
                <label className="advanced-radio">
                  <input type="radio" name="target-scope" checked={targetScope === 'all-proprietary'} onChange={() => setTargetScope('all-proprietary')} />
                  <span>All proprietary</span>
                </label>
                <label className="advanced-radio">
                  <input type="radio" name="target-scope" checked={targetScope === 'all-drawthings'} onChange={() => setTargetScope('all-drawthings')} />
                  <span>All Draw Things</span>
                </label>
              </>
            )}
            <label className="advanced-radio">
              <input type="radio" name="target-scope" checked={targetScope === 'all'} onChange={() => setTargetScope('all')} />
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
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
          />

          <div className="advanced-total">
            {totalTasks} task{totalTasks === 1 ? '' : 's'}
          </div>

          {message && <div className="advanced-message">{message}</div>}

          <button
            className="modal-btn modal-btn-primary advanced-queue-btn"
            onClick={() => void handleQueue()}
            disabled={queueBusy || queueDisabledReason !== null}
            title={queueDisabledReason ?? ''}
          >
            {queueBusy ? 'Queueing…' : 'Queue Tasks'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
