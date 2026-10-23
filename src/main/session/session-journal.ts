import path from 'node:path'
import fs from 'node:fs/promises'
import type { BackendId, ElaboratedPromptRecord, SessionManifest, Task } from '../../shared/types'
import { BACKEND_IDS_IN_UI_ORDER } from '../../shared/types'
import type { QueueChanges } from '../queue/queue-manager'
import { writeFileAtomicAsync } from '../utils/atomic-write'
import { FORMAT_VERSIONS } from '../store-format'
import { appendSessionTransition, type SessionTransition } from './journal-file'

type TaskMaps = Map<BackendId, Map<string, Task>>
const taskKey = (task: Task): string => JSON.stringify([task.id, task.prompt, task.model, task.params, task.baseName])

export function sessionContentKey(prompts: ElaboratedPromptRecord[], tasks: Record<BackendId, Task[]>): string {
  return JSON.stringify({ elaboratedPrompts: prompts, tasks: BACKEND_IDS_IN_UI_ORDER.map(backend => tasks[backend].map(task => [task.id, task.prompt, task.model, task.params, task.baseName])) })
}

export function taskMaps(tasks: Record<BackendId, Task[]>): TaskMaps {
  return new Map(BACKEND_IDS_IN_UI_ORDER.map(backend => [backend, new Map([...tasks[backend]].reverse().map(task => [task.id, task]))]))
}
export function applyTransition(maps: TaskMaps, transition: Pick<SessionTransition, 'upserts' | 'removed'>): void {
  for (const item of transition.removed) maps.get(item.backend)!.delete(item.id)
  for (const task of transition.upserts) maps.get(task.backend)!.set(task.id, task)
}
export function tasksFromMaps(maps: TaskMaps): Record<BackendId, Task[]> {
  return Object.fromEntries([...maps].map(([backend, tasks]) => [backend, [...tasks.values()].reverse()])) as Record<BackendId, Task[]>
}
export function countTasks(tasks: Record<BackendId, Task[]>): SessionManifest['taskCounts'] {
  const counts = { total: 0, queued: 0, generating: 0, completed: 0, kept: 0, failed: 0, interrupted: 0 }
  for (const rows of Object.values(tasks)) for (const task of rows) { counts.total++; counts[task.status]++ }
  return counts
}

interface CapturedSave {
  changes: QueueChanges
  prompts: ElaboratedPromptRecord[]
  promptsKey: string
  promptsBytes: number
  contentAt: string
}

/** Sessions are transient export work, so neither checkpoints nor this journal
 * create backup history. One session owns its ordered durable state. Incremental writes contain only changed
 * tasks; a checkpoint is earned when accumulated journal bytes reach roughly
 * the current snapshot size, making full serialization amortized linear. */
export class SessionJournal {
  private maps: TaskMaps
  private observed: Map<BackendId, Map<string, string>>
  private promptSource: ElaboratedPromptRecord[]
  private observedPrompts: ElaboratedPromptRecord[]
  private observedPromptKey: string
  private observedPromptBytes: number
  private savedPromptKey: string
  private contentAt: string
  private confirmedBytes: number
  private taskBytes: number
  private checkpointRequired = false
  private metadata: Omit<SessionManifest, 'tasks' | 'taskCounts'>

  constructor(readonly directory: string, manifest: SessionManifest, journalBytes = 0) {
    this.maps = taskMaps(manifest.tasks)
    this.observed = this.contentMaps(manifest.tasks)
    this.promptSource = manifest.elaboratedPrompts
    this.observedPrompts = manifest.elaboratedPrompts
    this.observedPromptKey = this.savedPromptKey = JSON.stringify(manifest.elaboratedPrompts)
    this.observedPromptBytes = Buffer.byteLength(this.observedPromptKey)
    this.contentAt = manifest.updatedAt
    this.confirmedBytes = journalBytes
    this.taskBytes = Object.values(manifest.tasks).flat().reduce((sum, task) => sum + Buffer.byteLength(JSON.stringify(task)), 0)
    const { tasks: _tasks, taskCounts: _counts, ...metadata } = manifest
    this.metadata = { ...metadata, formatVersion: FORMAT_VERSIONS.session, journalSequence: manifest.journalSequence ?? 0 }
  }

  private contentMaps(tasks: Record<BackendId, Task[]>): Map<BackendId, Map<string, string>> {
    return new Map(BACKEND_IDS_IN_UI_ORDER.map(backend => [backend, new Map([...tasks[backend]].reverse().map(task => [task.id, taskKey(task)]))]))
  }

  capture(changes: QueueChanges, prompts: ElaboratedPromptRecord[]): CapturedSave {
    let edited = false
    if (changes.reset) {
      const next = this.contentMaps(changes.reset)
      edited = BACKEND_IDS_IN_UI_ORDER.some(backend => JSON.stringify([...next.get(backend)!]) !== JSON.stringify([...this.observed.get(backend)!]))
      this.observed = next
    } else {
      for (const item of changes.removed) edited = this.observed.get(item.backend)!.delete(item.id) || edited
      for (const task of changes.upserts) {
        const key = taskKey(task)
        if (this.observed.get(task.backend)!.get(task.id) !== key) edited = true
        this.observed.get(task.backend)!.set(task.id, key)
      }
    }
    if (prompts !== this.promptSource) {
      const key = JSON.stringify(prompts)
      edited = edited || key !== this.observedPromptKey
      this.promptSource = prompts
      this.observedPrompts = structuredClone(prompts)
      this.observedPromptKey = key
      this.observedPromptBytes = Buffer.byteLength(key)
    }
    if (edited) this.contentAt = new Date().toISOString()
    return { changes, prompts: this.observedPrompts, promptsKey: this.observedPromptKey, promptsBytes: this.observedPromptBytes, contentAt: this.contentAt }
  }

  private manifest(maps = this.maps, metadata = this.metadata): SessionManifest {
    const tasks = tasksFromMaps(maps)
    return { ...metadata, tasks, taskCounts: countTasks(tasks) }
  }

  /** Creation/resume checkpoints already include every replayed transition.
   * Old journal bytes can remain until the next append truncates them: their
   * sequence is covered by the synced checkpoint, including after a crash. */
  async checkpoint(): Promise<void> {
    this.checkpointRequired = true
    await fs.mkdir(this.directory, { recursive: true })
    await writeFileAtomicAsync(path.join(this.directory, 'session.json'), JSON.stringify(this.manifest(), null, 2), false)
    this.confirmedBytes = 0
    this.checkpointRequired = false
  }

  async commit(save: CapturedSave): Promise<{ updatedAt: string }> {
    const { changes } = save
    const promptsChanged = save.promptsKey !== this.savedPromptKey
    const changedContent = promptsChanged || (changes.reset
      ? sessionContentKey(save.prompts, changes.reset) !== sessionContentKey(this.metadata.elaboratedPrompts, tasksFromMaps(this.maps))
      : changes.removed.some(item => this.maps.get(item.backend)!.has(item.id)) ||
        changes.upserts.some(task => {
          const old = this.maps.get(task.backend)!.get(task.id)
          return !old || taskKey(old) !== taskKey(task)
        }))
    const updatedAt = changedContent ? save.contentAt : this.metadata.updatedAt
    const sequence = (this.metadata.journalSequence ?? 0) + 1
    const transition: SessionTransition = {
      sequence, updatedAt, upserts: changes.upserts, removed: changes.removed,
      ...(promptsChanged ? { elaboratedPrompts: save.prompts } : {}),
    }
    let nextTaskBytes = this.taskBytes
    for (const item of changes.removed) {
      const old = this.maps.get(item.backend)!.get(item.id)
      if (old) nextTaskBytes -= Buffer.byteLength(JSON.stringify(old))
    }
    for (const task of changes.upserts) {
      const old = this.maps.get(task.backend)!.get(task.id)
      nextTaskBytes += Buffer.byteLength(JSON.stringify(task)) - (old ? Buffer.byteLength(JSON.stringify(old)) : 0)
    }
    const metadata = { ...this.metadata, journalSequence: sequence, updatedAt, elaboratedPrompts: save.prompts }
    const recordBytes = Buffer.byteLength(JSON.stringify(transition)) + 1
    const checkpointSize = nextTaskBytes + save.promptsBytes + Buffer.byteLength(JSON.stringify({ ...metadata, elaboratedPrompts: [] }))
    if (changes.reset || this.checkpointRequired || this.confirmedBytes + recordBytes >= checkpointSize) {
      const maps = changes.reset ? taskMaps(changes.reset) : new Map([...this.maps].map(([backend, tasks]) => [backend, new Map(tasks)]))
      if (!changes.reset) applyTransition(maps, transition)
      // A failed rename/directory sync has an uncertain outcome. Until a full
      // checkpoint succeeds again, appending could reuse an already published
      // sequence and hide later work, so retries stay on the checkpoint path.
      this.checkpointRequired = true
      await fs.mkdir(this.directory, { recursive: true })
      await writeFileAtomicAsync(path.join(this.directory, 'session.json'), JSON.stringify(this.manifest(maps, metadata), null, 2), false)
      this.maps = maps
      this.confirmedBytes = 0
      this.checkpointRequired = false
      if (changes.reset) nextTaskBytes = Object.values(changes.reset).flat().reduce((sum, task) => sum + Buffer.byteLength(JSON.stringify(task)), 0)
    } else {
      this.confirmedBytes = await appendSessionTransition(this.directory, this.confirmedBytes, transition)
      applyTransition(this.maps, transition)
    }
    this.taskBytes = nextTaskBytes
    this.metadata = metadata
    this.savedPromptKey = save.promptsKey
    return { updatedAt }
  }
}
