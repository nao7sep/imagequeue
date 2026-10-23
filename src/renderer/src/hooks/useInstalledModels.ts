import { useCallback, useSyncExternalStore } from 'react'
import type { CliStatus, LocalModelInfo } from '../../../shared/types'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { sortLocalModels } from '../utils/localModels'
import { presentFailure } from '../utils/failurePresentation'
import { setDrawThingsReady } from './useVisiblePanes'

interface Inventory {
  directory: string | null
  models: LocalModelInfo[]
  cliStatus: CliStatus | null
  status: 'loading' | 'ready' | 'failed'
  error: MessageKey | null
  revision: number
}
const INITIAL: Inventory = { directory: null, models: [], cliStatus: null, status: 'loading', error: null, revision: 0 }
const INACTIVE: Inventory = { ...INITIAL, status: 'ready' }
let snapshot = INITIAL
let directory = ''
let revision = 0
let requested = false
let running = false
let stopObserving: (() => void) | null = null
const listeners = new Set<() => void>()

function publish(next: Inventory): void {
  snapshot = next
  listeners.forEach((listener) => listener())
}
function sameModels(a: LocalModelInfo[], b: LocalModelInfo[]): boolean {
  return a.length === b.length && a.every((model, index) => {
    const other = b[index]
    return model.file === other.file && model.name === other.name && model.source === other.source
      && model.downloaded === other.downloaded && model.huggingFace === other.huggingFace
  })
}

// All consumers share one physical scan. An invalidation during a scan requests
// one follow-up; its old result cannot describe a newer directory or completed job.
async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (requested && listeners.size > 0) {
      requested = false
      const current = revision
      const source = directory
      const api = window.electronAPI
      let cliStatus: CliStatus | null = null
      try {
        cliStatus = await api.localCheckCli()
        if (current !== revision) continue
        const models = cliStatus.installed ? sortLocalModels(await api.localListDownloadedModels()) : []
        if (current !== revision) continue
        const retained = snapshot.directory === source && sameModels(snapshot.models, models) ? snapshot.models : models
        setDrawThingsReady(cliStatus.installed && models.length > 0)
        publish({ directory: source, models: retained, cliStatus, status: 'ready', error: null, revision: snapshot.revision + 1 })
      } catch (error) {
        if (current !== revision) continue
        setDrawThingsReady(false)
        publish({ ...snapshot, directory: source, cliStatus, status: 'failed',
          error: presentFailure(cliStatus ? 'drawthings-models-poll' : 'drawthings-cli-load', error) })
      }
    }
  } finally { running = false }
}

function refresh(): void {
  revision++
  requested = true
  void drain()
}

function subscribe(listener: () => void, source: string): () => void {
  const first = listeners.size === 0
  listeners.add(listener)
  if (first) {
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    window.addEventListener('dependencies-changed', refresh)
    const stopJobs = window.electronAPI.onCliJobStatus((event) => {
      if (event.status === 'exited' || event.status === 'killed' || event.status === 'timed-out') refresh()
    })
    stopObserving = () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('dependencies-changed', refresh)
      stopJobs()
    }
  }
  if (first || directory !== source) {
    directory = source
    setDrawThingsReady(false)
    publish({ ...INITIAL, directory: source })
    refresh()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    stopObserving?.()
    stopObserving = null
    revision++
    requested = false
    snapshot = INITIAL
    // The physical scan keeps its reservation until settlement, even if every
    // consumer unmounts and a new consumer subscribes in the meantime.
  }
}

export function useInstalledModels(active: boolean, modelsDirectory: string): Inventory {
  const observe = useCallback((listener: () => void) => active ? subscribe(listener, modelsDirectory) : () => {}, [active, modelsDirectory])
  const read = useCallback(() => !active ? INACTIVE : snapshot.directory === modelsDirectory ? snapshot : INITIAL, [active, modelsDirectory])
  return useSyncExternalStore(observe, read)
}
