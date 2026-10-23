import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const h = vi.hoisted(() => ({ changed: () => {}, unsubscribe: vi.fn() }))
vi.mock('../../src/main/i18n', () => ({
  onLanguageChanged: (listener: () => void) => { h.changed = listener; return h.unsubscribe },
}))
const { retainWindowTitle } = await import('../../src/main/window-title')

it('rejects the common page title, follows language changes, and releases its listener on close', () => {
  let title = 'Preview'
  let destroyed = false
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed, setTitle: vi.fn() })
  retainWindowTitle(win as unknown as BrowserWindow, () => title)
  const event = { preventDefault: vi.fn() }
  win.emit('page-title-updated', event, 'ImageQueue')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  title = 'プレビュー'
  h.changed()
  expect(win.setTitle).toHaveBeenCalledExactlyOnceWith(title)
  destroyed = true
  win.emit('closed')
  expect(h.unsubscribe).toHaveBeenCalledOnce()
  h.changed()
  expect(win.setTitle).toHaveBeenCalledOnce()
})
