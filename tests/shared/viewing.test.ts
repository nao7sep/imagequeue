import { describe, expect, it } from 'vitest'
import { canShowImage, listKeyFor, newerSnapshot, selectedImageOf } from '../../src/shared/viewing'
import type { Task } from '../../src/shared/types'

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean }> = {}) =>
  listKeyFor({ key: k, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...mods })

describe('canShowImage', () => {
  it('shows a completed or kept task that has an image, and nothing else', () => {
    expect(canShowImage({ status: 'completed', baseName: 'a' })).toBe(true)
    expect(canShowImage({ status: 'kept', baseName: 'a' })).toBe(true)
    expect(canShowImage({ status: 'completed', baseName: null })).toBe(false)
    for (const status of ['queued', 'generating', 'failed', 'interrupted'] as const) {
      expect(canShowImage({ status, baseName: 'a' })).toBe(false)
    }
    expect(canShowImage(null)).toBe(false)
  })
})

describe('listKeyFor', () => {
  it('reads keys as the lists do', () => {
    expect(key('ArrowUp')).toBe('up')
    expect(key('ArrowDown')).toBe('down')
    expect(key('ArrowLeft')).toBe('left')
    expect(key('ArrowRight')).toBe('right')
    expect(key(' ')).toBe('space')
    expect(key('Backspace')).toBe('remove')
    expect(key('Delete')).toBe('delete')
    expect(key('Backspace', { metaKey: true })).toBe('delete')
    expect(key('Backspace', { ctrlKey: true })).toBe('delete')
  })

  it('ignores other keys and modified ones', () => {
    expect(key('Escape')).toBeNull()
    expect(key('a')).toBeNull()
    expect(key('ArrowUp', { metaKey: true })).toBeNull()
    expect(key('Backspace', { altKey: true })).toBeNull()
    expect(key('Backspace', { metaKey: true, altKey: true })).toBeNull()
  })

  it('repeats only arrows while a key is held', () => {
    expect(key('ArrowRight', { repeat: true })).toBe('right')
    expect(key(' ', { repeat: true })).toBeNull()
    expect(key('Backspace', { repeat: true })).toBeNull()
    expect(key('Delete', { repeat: true })).toBeNull()
  })
})

describe('newerSnapshot', () => {
  it('keeps the newer snapshot and takes an equal one again', () => {
    const v1 = { version: 1, task: null }
    const v2 = { version: 2, task: null }
    expect(newerSnapshot(null, v1)).toBe(v1)
    expect(newerSnapshot(v1, v2)).toBe(v2)
    expect(newerSnapshot(v2, v1)).toBe(v2)
    const again = { version: 2, task: null }
    expect(newerSnapshot(v2, again)).toBe(again)
  })
})

describe('selectedImageOf', () => {
  it('carries what the views show, nothing more', () => {
    const task = {
      id: 't', prompt: 'p', backend: 'openai', model: 'm', params: {}, status: 'failed',
      enqueuedAt: '', startedAt: null, completedAt: null, durationMs: null, imagePath: null,
      baseName: null, error: { key: 'taskFailure.unknown' }, providerMessage: 'no',
    } as Task
    expect(selectedImageOf(task)).toEqual({ taskId: 't', status: 'failed', baseName: null, error: { key: 'taskFailure.unknown' }, providerMessage: 'no' })
    expect(selectedImageOf(null)).toBeNull()
  })
})
