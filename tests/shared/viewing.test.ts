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
    expect(key('Backspace')).toBe('remove')
    expect(key('Delete')).toBe('delete')
    expect(key('Backspace', { metaKey: true })).toBe('delete')
    expect(key('Backspace', { ctrlKey: true })).toBe('delete')
  })

  it('ignores other keys and modified ones', () => {
    expect(key('Escape')).toBeNull()
    expect(key(' ')).toBeNull()
    expect(key('a')).toBeNull()
    expect(key('ArrowUp', { metaKey: true })).toBeNull()
    expect(key('Backspace', { altKey: true })).toBeNull()
    expect(key('Backspace', { metaKey: true, altKey: true })).toBeNull()
  })

  it('repeats only arrows while a key is held', () => {
    expect(key('ArrowRight', { repeat: true })).toBe('right')
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

// The preview window's minimum is computed in shared/viewing.ts from the
// stylesheets' padding, gap, image floor and failure-strip cap; each figure is
// read from the stylesheet that sets it, so the two cannot drift apart.
describe('preview window minimum size', () => {
  it('fits the preview window\'s layout as its stylesheets draw it', async () => {
    const { readFileSync } = await import('node:fs')
    const { PREVIEW_WINDOW_MIN_HEIGHT } = await import('../../src/shared/viewing')
    const css = (path: string): string => readFileSync(new URL(`../../src/renderer/src/${path}`, import.meta.url), 'utf8')
    const rule = (source: string, selector: string): string => {
      const match = new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(source)
      expect(match, selector).not.toBeNull()
      return match![1]!
    }
    const declaration = (body: string, property: string): string => {
      const match = new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`).exec(body)
      expect(match, property).not.toBeNull()
      return match![1]!.trim()
    }
    const tokens = css('styles.css')
    const token = (name: string): number => {
      const match = new RegExp(`--${name}:\\s*(\\d+)px;`).exec(tokens)
      expect(match, name).not.toBeNull()
      return Number(match![1])
    }
    const px = (value: string): number => {
      const variable = /^var\(--([\w-]+)\)$/.exec(value)
      if (variable) return token(variable[1]!)
      expect(value).toMatch(/^\d+px$/)
      return parseFloat(value)
    }

    const shell = rule(css('viewing/PreviewWindow.css'), '.preview-window')
    const preview = css('components/Preview.css')
    const area = rule(preview, '.preview-area')
    const failure = rule(preview, '.preview-failure')

    // max-height: calc(<line-height>em * <lines> + 2 * var(--space-2) + <border>px)
    const cap = /^calc\(([\d.]+)em \* (\d+) \+ 2 \* var\(--([\w-]+)\) \+ (\d+)px\)$/.exec(declaration(failure, 'max-height'))
    expect(cap, 'failure strip cap').not.toBeNull()
    const fontSize = px(declaration(failure, 'font-size'))
    expect(Number(cap![1])).toBe(Number(declaration(failure, 'line-height')))
    const failureCap = Math.ceil(fontSize * Number(cap![1]) * Number(cap![2])) + 2 * token(cap![3]!) + Number(cap![4])

    expect(PREVIEW_WINDOW_MIN_HEIGHT).toBe(
      2 * px(declaration(shell, 'padding')) + px(declaration(area, 'min-height')) + px(declaration(shell, 'gap')) + failureCap,
    )
  })
})
