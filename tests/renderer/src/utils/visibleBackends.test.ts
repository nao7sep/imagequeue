import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getVisibleBackends,
  getVisiblePanesForUi,
} from '../../../../src/renderer/src/utils/visibleBackends'
import { BACKEND_IDS_IN_UI_ORDER, CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../../../src/shared/types'
import type { ApiKeyPresence, BackendId, Task } from '../../../../src/shared/types'

// These read window.electronAPI?.platform; the node env has no window, so each
// case stubs it. Two rules are pinned here beyond the platform filter: a column
// number always means a VISIBLE column (the Cmd+N shortcuts derive from this
// list), and presence that has not loaded yet hides nothing.

afterEach(() => {
  vi.unstubAllGlobals()
})

function onMac(): void {
  vi.stubGlobal('window', { electronAPI: { platform: 'darwin' } })
}
function onWindows(): void {
  vi.stubGlobal('window', { electronAPI: { platform: 'win32' } })
}

const presence = (keyed: readonly string[]): ApiKeyPresence => ({
  image: Object.fromEntries(
    CLOUD_BACKEND_IDS_IN_UI_ORDER.map((id) => [id, keyed.includes(id)])
  ) as ApiKeyPresence['image'],
  geminiText: false,
  openaiText: false,
})

const noTasks = (): Record<BackendId, Task[]> => ({
  openai: [], nanobanana: [], grok: [], flux: [], drawthings: [],
})

const withTask = (backend: BackendId): Record<BackendId, Task[]> => ({
  ...noTasks(),
  [backend]: [{ id: 't1' } as Task],
})

describe('getVisibleBackends', () => {
  it('shows every backend, including Draw Things, on macOS when all are keyed', () => {
    onMac()
    expect(getVisibleBackends(presence(CLOUD_BACKEND_IDS_IN_UI_ORDER), noTasks())).toEqual(
      BACKEND_IDS_IN_UI_ORDER
    )
  })

  it('hides Draw Things off macOS', () => {
    onWindows()
    expect(getVisibleBackends(presence(CLOUD_BACKEND_IDS_IN_UI_ORDER), noTasks())).not.toContain(
      'drawthings'
    )
  })

  it('hides Draw Things when the platform is unknown', () => {
    vi.stubGlobal('window', {})
    expect(getVisibleBackends(presence(CLOUD_BACKEND_IDS_IN_UI_ORDER), noTasks())).not.toContain(
      'drawthings'
    )
  })

  it('hides a cloud backend with no key', () => {
    onWindows()
    expect(getVisibleBackends(presence(['openai']), noTasks())).toEqual(['openai'])
  })

  // The reason Cmd+N had to become reactive: hiding a provider renumbers the
  // columns, so the second visible column is no longer the second backend.
  it('renumbers columns when a provider is hidden', () => {
    onWindows()
    const all = getVisibleBackends(presence(CLOUD_BACKEND_IDS_IN_UI_ORDER), noTasks())
    const hidden = getVisibleBackends(presence(['nanobanana', 'grok', 'flux']), noTasks())
    expect(all[0]).toBe('openai')
    expect(hidden[0]).toBe('nanobanana')
    expect(hidden).not.toContain('openai')
  })

  it('keeps an unkeyed backend visible while it holds tasks', () => {
    onWindows()
    expect(getVisibleBackends(presence([]), withTask('grok'))).toEqual(['grok'])
  })

  // Startup: presence is null for a moment. Nothing may disappear in that window.
  it('hides nothing while presence is still loading', () => {
    onWindows()
    expect(getVisibleBackends(null, noTasks())).toEqual(
      BACKEND_IDS_IN_UI_ORDER.filter((b) => b !== 'drawthings')
    )
  })
})

describe('getVisiblePanesForUi', () => {
  it('stands the welcome pane in when nothing is keyed off macOS', () => {
    onWindows()
    expect(getVisiblePanesForUi(presence([]), noTasks())).toEqual(['welcome'])
  })

  it('never shows the welcome pane on macOS, where Draw Things always fills the group', () => {
    onMac()
    expect(getVisiblePanesForUi(presence([]), noTasks())).toEqual(['drawthings'])
  })
})
