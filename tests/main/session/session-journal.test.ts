import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionManifest } from '../../../src/shared/types'
import { SessionJournal, applyTransition, countTasks, taskMaps, tasksFromMaps } from '../../../src/main/session/session-journal'
import { readSessionJournal, type SessionTransition } from '../../../src/main/session/journal-file'
import { createEmptyQueues, QueueManager } from '../../../src/main/queue/queue-manager'
import * as sync from '../../../src/main/utils/fsync'
import { FORMAT_VERSIONS } from '../../../src/main/store-format'

vi.mock('../../../src/main/backup/backup-store', () => ({ record: vi.fn() }))
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'imagequeue-session-journal-')) })
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await fs.rm(root, { recursive: true, force: true }) })
const validate = (value: unknown): value is SessionTransition => !!value && typeof value === 'object' && 'sequence' in value
async function read(): Promise<SessionManifest> {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'session.json'), 'utf8')) as SessionManifest
  const maps = taskMaps(manifest.tasks)
  const replay = await readSessionJournal(root, manifest.journalSequence ?? 0, validate, transition => {
    applyTransition(maps, transition)
    manifest.updatedAt = transition.updatedAt
    if (transition.elaboratedPrompts) manifest.elaboratedPrompts = transition.elaboratedPrompts
  })
  return { ...manifest, tasks: tasksFromMaps(maps), journalSequence: replay.sequence }
}
async function fixture(count = 100) {
  const queue = new QueueManager()
  const rows = queue.enqueue({ backend: 'openai', model: 'gpt-image-2', prompt: 'a carefully composed still life', params: {}, count })
  const tasks = queue.getAllStoredTasks()
  const manifest: SessionManifest = {
    formatVersion: FORMAT_VERSIONS.session, sessionId: path.basename(root), journalSequence: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastResumedAt: null,
    tasks, taskCounts: countTasks(tasks), elaboratedPrompts: [],
  }
  const store = new SessionJournal(root, manifest)
  await store.checkpoint()
  queue.ackChanges('durability', queue.currentRevision)
  const save = async () => {
    const changes = queue.captureChanges('durability')
    const result = await store.commit(store.capture(changes, manifest.elaboratedPrompts))
    queue.ackChanges('durability', changes.revision)
    return result
  }
  return { queue, rows, store, save, manifest }
}

it('writes small transitions and amortizes checkpoints across a large batch without losing order or outcomes', async () => {
  const { queue, rows, save } = await fixture(64)
  const rename = vi.spyOn(fs, 'rename')
  for (const task of rows) {
    queue.updateTask(task, { status: 'generating' })
    await save()
    queue.updateTask(task, { status: 'completed', baseName: task.id, imagePath: `${task.id}.png` })
    await save()
  }
  expect(rename.mock.calls.length).toBeLessThan(rows.length / 10)
  const recovered = await read()
  expect(recovered.tasks.openai.map(task => task.id)).toEqual([...rows].reverse().map(task => task.id))
  expect(recovered.tasks.openai.every(task => task.status === 'completed')).toBe(true)
  expect(recovered.journalSequence).toBe(rows.length * 2)
})

it('preserves observed edit time and required pending output through an uncertain append and retry', async () => {
  const { queue, rows, save } = await fixture()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'))
  const pendingOutput = { baseName: 'paid', ext: 'png' as const, sha256: 'a'.repeat(64) }
  queue.updateTask(rows[0], { prompt: 'new authored prompt', pendingOutput })
  vi.spyOn(sync, 'syncDirectoryAsync').mockRejectedValueOnce(new Error('sync uncertain'))
  await expect(save()).rejects.toThrow('sync uncertain')
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  expect((await save()).updatedAt).toBe('2026-02-01T00:00:00.000Z')
  const recovered = await read()
  expect(recovered.tasks.openai.find(task => task.id === rows[0].id)).toMatchObject({ prompt: 'new authored prompt', pendingOutput })
  expect(recovered.journalSequence).toBe(1)
})

it('retries an uncertain checkpoint as a checkpoint before allowing later appends', async () => {
  const { queue, rows, save } = await fixture()
  const original = fs.rename.bind(fs)
  const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
    await original(from, to)
    throw new Error('checkpoint acknowledgement lost')
  })
  queue.replaceAllTasks({ ...createEmptyQueues(), openai: [rows[0]] })
  await expect(save()).rejects.toThrow('checkpoint acknowledgement lost')
  const owned = queue.getTask('openai', rows[0].id)!
  queue.updateTask(owned, { prompt: 'after uncertain checkpoint' })
  await save()
  expect(rename).toHaveBeenCalledTimes(2)
  const recovered = await read()
  expect(recovered.tasks.openai).toHaveLength(1)
  expect(recovered.tasks.openai[0].prompt).toBe('after uncertain checkpoint')
})

it('ignores old journal records covered by a checkpoint and truncates them only on the next append', async () => {
  const { queue, rows, store, save } = await fixture()
  queue.updateTask(rows[0], { status: 'generating' })
  await save()
  const oldJournal = await fs.readFile(path.join(root, 'session-changes.jsonl'))
  await store.checkpoint()
  expect(await fs.readFile(path.join(root, 'session-changes.jsonl'))).toEqual(oldJournal)
  expect((await read()).tasks.openai.find(task => task.id === rows[0].id)?.status).toBe('generating')
  queue.updateTask(rows[0], { status: 'failed' })
  await save()
  const lines = (await fs.readFile(path.join(root, 'session-changes.jsonl'), 'utf8')).trim().split('\n')
  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0]).sequence).toBe(2)
  expect((await read()).tasks.openai.find(task => task.id === rows[0].id)?.status).toBe('failed')
})

it('dates a reset that changes only task order as content, while lifecycle changes preserve its date', async () => {
  const { queue, rows, save } = await fixture(3)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'))
  queue.replaceAllTasks({ ...createEmptyQueues(), openai: rows })
  expect((await save()).updatedAt).toBe('2026-02-01T00:00:00.000Z')
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  queue.updateTask(queue.getTask('openai', rows[0].id)!, { status: 'generating' })
  expect((await save()).updatedAt).toBe('2026-02-01T00:00:00.000Z')
})

it('skips unchanged and already-covered captures without changing durable sequence', async () => {
  const { queue, rows, store, save, manifest } = await fixture()
  const open = vi.spyOn(fs, 'open')
  const rename = vi.spyOn(fs, 'rename')
  await save()
  expect(open).not.toHaveBeenCalled()
  expect(rename).not.toHaveBeenCalled()
  queue.updateTask(rows[0], { status: 'generating' })
  const changes = queue.captureChanges('durability')
  const first = store.capture(changes, manifest.elaboratedPrompts)
  const duplicate = store.capture(queue.captureChanges('durability'), manifest.elaboratedPrompts)
  await store.commit(first)
  open.mockClear()
  rename.mockClear()
  await store.commit(duplicate)
  expect(open).not.toHaveBeenCalled()
  expect(rename).not.toHaveBeenCalled()
  queue.ackChanges('durability', changes.revision)
  queue.replaceAllTasks(queue.getAllStoredTasks())
  await save()
  expect(open).not.toHaveBeenCalled()
  expect(rename).not.toHaveBeenCalled()
  expect((await read()).journalSequence).toBe(1)
})

it('repairs an uncertain append even when a later edit returns to the confirmed state', async () => {
  const { queue, rows, save } = await fixture()
  queue.updateTask(rows[0], { status: 'generating' })
  vi.spyOn(sync, 'syncDirectoryAsync').mockRejectedValueOnce(new Error('uncertain append'))
  await expect(save()).rejects.toThrow('uncertain append')
  queue.updateTask(rows[0], { status: 'queued' })
  await save()
  expect((await read()).tasks.openai.find(task => task.id === rows[0].id)?.status).toBe('queued')
})

it('repairs an uncertain checkpoint even when no content changes remain', async () => {
  const { store, save } = await fixture()
  vi.spyOn(sync, 'syncDirectoryAsync').mockRejectedValueOnce(new Error('uncertain checkpoint'))
  await expect(store.checkpoint()).rejects.toThrow('uncertain checkpoint')
  const rename = vi.spyOn(fs, 'rename')
  await save()
  expect(rename).toHaveBeenCalledOnce()
  expect((await read()).journalSequence).toBe(1)
})
