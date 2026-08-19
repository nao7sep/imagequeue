import { describe, expect, it } from 'vitest'
import {
  WELCOME_PANE,
  getVisibleBackendColumns,
  getVisiblePanes,
} from '../../src/shared/layout-metrics'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, type CloudBackendId } from '../../src/shared/types'

const ALL_KEYED = CLOUD_BACKEND_IDS_IN_UI_ORDER as CloudBackendId[]
const NONE_KEYED: CloudBackendId[] = []

describe('getVisiblePanes', () => {
  it('shows every keyed cloud backend, and Draw Things only on macOS', () => {
    expect(getVisiblePanes('darwin', ALL_KEYED)).toEqual([...ALL_KEYED, 'drawthings'])
    expect(getVisiblePanes('win32', ALL_KEYED)).toEqual([...ALL_KEYED])
  })

  it('drops a cloud backend that has no key', () => {
    const panes = getVisiblePanes('win32', ['openai'])
    expect(panes).toEqual(['openai'])
  })

  it('keeps Draw Things on macOS whether or not it is installed', () => {
    // It needs no key, and its own column carries the route to the installer.
    expect(getVisiblePanes('darwin', ['openai'])).toEqual(['openai', 'drawthings'])
  })

  it('stands the welcome pane in when the group would otherwise be empty', () => {
    expect(getVisiblePanes('win32', NONE_KEYED)).toEqual([WELCOME_PANE])
    expect(getVisiblePanes('linux', NONE_KEYED)).toEqual([WELCOME_PANE])
  })

  it('never shows the welcome pane on macOS, where Draw Things always fills the group', () => {
    // The pane is unreachable on macOS by construction — which is why it says
    // nothing about a backend only macOS can run.
    expect(getVisiblePanes('darwin', NONE_KEYED)).toEqual(['drawthings'])
  })

  it('does not show the welcome pane once any cloud backend is keyed', () => {
    expect(getVisiblePanes('win32', ['flux'])).toEqual(['flux'])
  })

  it('is the only pane when it appears', () => {
    expect(getVisiblePanes('win32', NONE_KEYED)).toHaveLength(1)
  })

  // Hiding a column that holds work would hide the work: a task left
  // generating, failing, or completing where it cannot be seen, retried, or
  // deleted. An unkeyed backend therefore keeps its column until its queue
  // empties — removing a key stops NEW work reaching it, nothing more.
  it('keeps an unkeyed backend visible while it still holds tasks', () => {
    expect(getVisiblePanes('win32', NONE_KEYED, ['grok'])).toEqual(['grok'])
    expect(getVisiblePanes('win32', ['openai'], ['grok'])).toEqual(['openai', 'grok'])
  })

  it('drops the column once the unkeyed backend has no tasks left', () => {
    expect(getVisiblePanes('win32', ['openai'], [])).toEqual(['openai'])
  })

  it('shows no welcome pane while any backend holds tasks, keyed or not', () => {
    expect(getVisiblePanes('win32', NONE_KEYED, ['flux'])).not.toContain(WELCOME_PANE)
  })

  it('keeps UI order regardless of the order backends are supplied in', () => {
    // Column NUMBER is what Cmd+N maps to, so order must come from the canonical
    // list, never from the order presence or task counts happened to arrive in.
    const panes = getVisiblePanes('win32', ['flux', 'openai'], ['grok'])
    expect(panes).toEqual(CLOUD_BACKEND_IDS_IN_UI_ORDER.filter((id) => panes.includes(id)))
  })
})

describe('getVisibleBackendColumns', () => {
  // Column shortcuts and selection navigation walk this list. The welcome pane
  // holds no tasks, so a shortcut must never land on it and arrowing must never
  // stop there.
  it('drops the welcome pane, leaving no column for a shortcut to land on', () => {
    const panes = getVisiblePanes('win32', NONE_KEYED)
    expect(panes).toContain(WELCOME_PANE)
    expect(getVisibleBackendColumns(panes)).toEqual([])
  })

  it('is unchanged when no welcome pane is present', () => {
    const panes = getVisiblePanes('darwin', ALL_KEYED)
    expect(getVisibleBackendColumns(panes)).toEqual(panes)
  })
})
