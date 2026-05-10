import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ElaboratorsModal } from './ElaboratorsModal'
import { useSettings } from '../context/SettingsContext'
import {
  BACKEND_LABELS,
  CLOUD_BACKEND_IDS_IN_UI_ORDER,
  type BackendId,
  type Elaborator,
  type LocalModelInfo,
} from '../../../shared/types'
import './AdvancedPromptingModal.css'

interface Props {
  initialPrompt?: string
  onClose: () => void
}

type PromptSource = 'as-is' | 'elaborated' | 'per-queue'
type TargetScope = 'selected' | 'all-paid' | 'all-free' | 'all'
type ElaborationMode = 'per-task' | 'per-model'

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
  const [elaborateBusy, setElaborateBusy] = useState(false)
  const [showManager, setShowManager] = useState(false)

  const [downloadedDtModels, setDownloadedDtModels] = useState<LocalModelInfo[]>([])
  const [selectedCloud, setSelectedCloud] = useState<Record<BackendId, boolean>>(() => ({
    openai: false, imagen: false, nanobanana: false, grok: false, flux: false, drawthings: false,
  }))
  const [selectedDtFiles, setSelectedDtFiles] = useState<Set<string>>(new Set())

  const [promptSource, setPromptSource] = useState<PromptSource>('as-is')
  const [targetScope, setTargetScope] = useState<TargetScope>('selected')
  const [count, setCount] = useState(1)
  const [elaborationMode, setElaborationMode] = useState<ElaborationMode>('per-task')

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
    window.electronAPI.localListDownloadedModels().then(setDownloadedDtModels)
  }, [])

  const cloudApiKeyByBackend = useMemo<Record<string, boolean>>(() => {
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

  const toggleCloud = (id: BackendId): void => {
    setSelectedCloud((cur) => ({ ...cur, [id]: !cur[id] }))
  }

  const toggleDtFile = (file: string): void => {
    setSelectedDtFiles((cur) => {
      const next = new Set(cur)
      if (next.has(file)) next.delete(file); else next.add(file)
      return next
    })
  }

  const effectiveTargets = useMemo(() => {
    const cloud: BackendId[] = []
    let dt: string[] = []

    if (targetScope === 'selected') {
      for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
        if (selectedCloud[id] && cloudApiKeyByBackend[id]) cloud.push(id)
      }
      dt = downloadedDtModels
        .map((m) => m.file)
        .filter((f) => selectedDtFiles.has(f))
    } else if (targetScope === 'all-paid') {
      for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
        if (cloudApiKeyByBackend[id]) cloud.push(id)
      }
    } else if (targetScope === 'all-free') {
      dt = downloadedDtModels.map((m) => m.file)
    } else {
      for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
        if (cloudApiKeyByBackend[id]) cloud.push(id)
      }
      dt = downloadedDtModels.map((m) => m.file)
    }
    return { cloud, dt }
  }, [targetScope, selectedCloud, selectedDtFiles, downloadedDtModels, cloudApiKeyByBackend])

  const targetCount = effectiveTargets.cloud.length + effectiveTargets.dt.length
  const totalTasks = Math.max(0, targetCount * Math.max(1, count))
  const elaboratorPicked = selectedElaboratorId !== null && elaborators.some((e) => e.id === selectedElaboratorId)
  const elaborateDisabledReason = (() => {
    if (!seed.trim()) return 'Enter a seed prompt above.'
    if (!elaboratorPicked) return 'Pick an elaborator first.'
    return null
  })()

  const promptSourceDisabledReason = (which: PromptSource): string | null => {
    if (which === 'elaborated' && !elaborated.trim()) return 'Run Elaborate first.'
    if (which === 'per-queue' && !elaboratorPicked) return 'Pick an elaborator first.'
    return null
  }

  // If the chosen prompt source becomes unavailable, fall back to as-is.
  useEffect(() => {
    if (promptSourceDisabledReason(promptSource)) setPromptSource('as-is')
  }, [elaborated, elaboratorPicked]) // eslint-disable-line react-hooks/exhaustive-deps

  const queueDisabledReason = (() => {
    if (totalTasks === 0) return 'Select at least one target.'
    if (promptSource === 'as-is' && !seed.trim()) return 'Seed prompt is empty.'
    if (promptSource === 'elaborated' && !elaborated.trim()) return 'Elaborated prompt is empty.'
    if (promptSource === 'per-queue' && !elaboratorPicked) return 'Pick an elaborator first.'
    if (promptSource === 'per-queue' && !seed.trim()) return 'Enter a seed prompt for elaboration.'
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
      setPromptSource('elaborated')
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
      const totalUnits = targetCount * copies

      let prompts: string[] = []
      if (promptSource === 'as-is') {
        prompts = [seed.trim()]
      } else if (promptSource === 'elaborated') {
        prompts = [elaborated.trim()]
      } else {
        if (!selectedElaboratorId) throw new Error('Pick an elaborator first.')
        const needed = elaborationMode === 'per-task' ? totalUnits : targetCount
        const result = await window.electronAPI.brainstormPrompts(selectedElaboratorId, seed, needed)
        prompts = result.prompts
        if (prompts.length === 0) throw new Error('Text AI returned no prompts.')
      }

      const promptForUnit = (targetIndex: number, copyIndex: number): string => {
        if (promptSource !== 'per-queue') return prompts[0]
        if (elaborationMode === 'per-model') {
          return prompts[targetIndex % prompts.length]
        }
        const unit = targetIndex * copies + copyIndex
        return prompts[unit % prompts.length]
      }

      let dispatched = 0

      // Cloud: dispatch enqueue-single events. Columns build params from their own UI state.
      // For per-task elaboration we send one event per copy (each carrying a unique prompt).
      // For shared prompts we can collapse into a single event with count=copies.
      const cloudList = targets.cloud
      cloudList.forEach((backendId, index) => {
        if (promptSource === 'per-queue' && elaborationMode === 'per-task') {
          for (let c = 0; c < copies; c++) {
            const p = promptForUnit(index, c)
            window.dispatchEvent(new CustomEvent('enqueue-single', { detail: { backend: backendId, prompt: p, count: 1 } }))
            dispatched++
          }
        } else {
          const p = promptForUnit(index, 0)
          window.dispatchEvent(new CustomEvent('enqueue-single', { detail: { backend: backendId, prompt: p, count: copies } }))
          dispatched += copies
        }
      })

      // DT: direct IPC, model override per selected DT model.
      for (let i = 0; i < targets.dt.length; i++) {
        const modelFile = targets.dt[i]
        const targetIndex = cloudList.length + i
        const { params } = await buildDtParams(modelFile)
        if (promptSource === 'per-queue' && elaborationMode === 'per-task') {
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
        } else {
          const p = promptForUnit(targetIndex, 0)
          await window.electronAPI.enqueue({
            prompt: p,
            backend: 'drawthings',
            model: modelFile,
            params: params as unknown as Record<string, unknown>,
            count: copies,
          })
          dispatched += copies
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
    queueDisabledReason, effectiveTargets, count, targetCount, promptSource,
    seed, elaborated, selectedElaboratorId, elaborationMode, buildDtParams, onClose,
  ])

  return (
    <Modal title="Advanced Prompting" className="advanced-modal-box" onClose={onClose}>
      <div className="advanced-body">
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
          <div className="advanced-row">
            <button
              className="modal-btn modal-btn-primary"
              onClick={() => void handleElaborate()}
              disabled={elaborateBusy || elaborateDisabledReason !== null}
              title={elaborateDisabledReason ?? 'Generate one elaborated prompt'}
            >
              {elaborateBusy ? 'Elaborating…' : 'Elaborate'}
            </button>
            <button className="modal-btn" onClick={() => setShowManager(true)} disabled={queueBusy}>
              Manage…
            </button>
          </div>
          <textarea
            className="advanced-elaborated"
            rows={4}
            placeholder="Elaborated prompt will appear here. You can edit before queueing."
            value={elaborated}
            onChange={(e) => setElaborated(e.target.value)}
          />
        </div>

        <div className="advanced-pane">
          <div className="advanced-pane-title">Targets</div>
          <div className="advanced-targets">
            <div className="advanced-targets-col">
              <div className="advanced-targets-col-title">Paid</div>
              {CLOUD_BACKEND_IDS_IN_UI_ORDER.map((id) => {
                const hasKey = cloudApiKeyByBackend[id]
                return (
                  <label key={id} className={`advanced-target-row${hasKey ? '' : ' disabled'}`}>
                    <input
                      type="checkbox"
                      checked={!!selectedCloud[id]}
                      disabled={!hasKey}
                      onChange={() => toggleCloud(id)}
                    />
                    <span>{BACKEND_LABELS[id]}</span>
                    {!hasKey && <span className="advanced-target-hint">no API key</span>}
                  </label>
                )
              })}
            </div>
            <div className="advanced-targets-col">
              <div className="advanced-targets-col-title">Free (Draw Things)</div>
              {!isMacPlatform ? (
                <div className="advanced-empty">Draw Things is macOS only.</div>
              ) : downloadedDtModels.length === 0 ? (
                <div className="advanced-empty">No models downloaded.</div>
              ) : (
                downloadedDtModels.map((m) => (
                  <label key={m.file} className="advanced-target-row">
                    <input
                      type="checkbox"
                      checked={selectedDtFiles.has(m.file)}
                      onChange={() => toggleDtFile(m.file)}
                    />
                    <span>{m.name || m.file}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="advanced-pane">
          <div className="advanced-pane-title">Execution</div>

          <div className="advanced-section-label">Prompt source</div>
          <div className="advanced-radio-group">
            <label className="advanced-radio">
              <input type="radio" name="prompt-source" checked={promptSource === 'as-is'} onChange={() => setPromptSource('as-is')} />
              <span>Use prompt as-is</span>
            </label>
            <label className={`advanced-radio${promptSourceDisabledReason('elaborated') ? ' disabled' : ''}`} title={promptSourceDisabledReason('elaborated') ?? ''}>
              <input
                type="radio"
                name="prompt-source"
                checked={promptSource === 'elaborated'}
                disabled={promptSourceDisabledReason('elaborated') !== null}
                onChange={() => setPromptSource('elaborated')}
              />
              <span>Use elaborated prompt</span>
            </label>
            <label className={`advanced-radio${promptSourceDisabledReason('per-queue') ? ' disabled' : ''}`} title={promptSourceDisabledReason('per-queue') ?? ''}>
              <input
                type="radio"
                name="prompt-source"
                checked={promptSource === 'per-queue'}
                disabled={promptSourceDisabledReason('per-queue') !== null}
                onChange={() => setPromptSource('per-queue')}
              />
              <span>Elaborate per task at queue time</span>
            </label>
          </div>

          <div className="advanced-section-label">Target scope</div>
          <div className="advanced-radio-group">
            <label className="advanced-radio">
              <input type="radio" name="target-scope" checked={targetScope === 'selected'} onChange={() => setTargetScope('selected')} />
              <span>Selected</span>
            </label>
            <label className="advanced-radio">
              <input type="radio" name="target-scope" checked={targetScope === 'all-paid'} onChange={() => setTargetScope('all-paid')} />
              <span>All paid</span>
            </label>
            <label className="advanced-radio">
              <input type="radio" name="target-scope" checked={targetScope === 'all-free'} onChange={() => setTargetScope('all-free')} />
              <span>All free</span>
            </label>
            <label className="advanced-radio">
              <input type="radio" name="target-scope" checked={targetScope === 'all'} onChange={() => setTargetScope('all')} />
              <span>All</span>
            </label>
          </div>

          <div className="advanced-section-label">How many times</div>
          <input
            className="advanced-count"
            type="number"
            min={1}
            max={9999}
            value={count}
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
          />

          <div className="advanced-section-label">Elaboration mode</div>
          <div className="advanced-radio-group">
            <label className={`advanced-radio${promptSource !== 'per-queue' ? ' muted' : ''}`}>
              <input
                type="radio"
                name="elab-mode"
                checked={elaborationMode === 'per-task'}
                onChange={() => setElaborationMode('per-task')}
              />
              <span>One elaboration per task</span>
            </label>
            <label className={`advanced-radio${promptSource !== 'per-queue' ? ' muted' : ''}`}>
              <input
                type="radio"
                name="elab-mode"
                checked={elaborationMode === 'per-model'}
                onChange={() => setElaborationMode('per-model')}
              />
              <span>One elaboration per model</span>
            </label>
            <div className="advanced-hint">Ignored when the prompt is fixed.</div>
          </div>

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

      {showManager && (
        <ElaboratorsModal onClose={() => setShowManager(false)} onChange={(items) => {
          setElaborators(items)
          setSelectedElaboratorId((current) => {
            if (current && items.some((e) => e.id === current)) return current
            return items[0]?.id ?? null
          })
        }} />
      )}
    </Modal>
  )
}
