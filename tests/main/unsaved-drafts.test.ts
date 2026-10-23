import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Main-window dialogs report unsaved edits so a close or quit can ask once
// before discarding them (unsaved-edits-conventions).
const handlers = vi.hoisted(() => new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>())
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: (event: { sender: unknown }, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
}))

let drafts: typeof import('../../src/main/unsaved-drafts')
let main: EventEmitter
const report = (sender: unknown, surface: unknown, dirty: unknown) => handlers.get('drafts:report')!({ sender }, surface, dirty)

beforeEach(async () => {
  vi.resetModules()
  handlers.clear()
  drafts = await import('../../src/main/unsaved-drafts')
  main = new EventEmitter()
  drafts.registerUnsavedDraftsIpc(() => main as unknown as Electron.WebContents)
})

describe('unsaved drafts', () => {
  it('lists the dialogs the main window reports, in a stable order, until each reports clean', () => {
    report(main, 'elaborators', true)
    report(main, 'settings', true)
    expect(drafts.unsavedDrafts()).toEqual(['settings', 'elaborators'])
    report(main, 'settings', false)
    expect(drafts.unsavedDrafts()).toEqual(['elaborators'])
  })

  it('ignores another page and an unknown dialog', () => {
    report(new EventEmitter(), 'settings', true)
    report(main, 'prompt', true)
    expect(drafts.unsavedDrafts()).toEqual([])
  })

  it('forgets every report when the main window\'s page goes away', () => {
    report(main, 'settings', true)
    main.emit('destroyed')
    expect(drafts.unsavedDrafts()).toEqual([])
  })
})


it('forgets lost-renderer reports and admits recovered-page reports without accumulating listeners', () => {
  report(main, 'settings', true)
  main.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  expect(drafts.unsavedDrafts()).toEqual([])
  expect(main.listenerCount('did-start-navigation')).toBe(0)
  report(main, 'elaborators', true)
  expect(drafts.unsavedDrafts()).toEqual(['elaborators'])
  expect(main.listenerCount('render-process-gone')).toBe(1)
  main.emit('did-start-navigation', {}, 'app', false, true)
  expect(drafts.unsavedDrafts()).toEqual([])
  expect(main.listenerCount('render-process-gone')).toBe(0)
})
