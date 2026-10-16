// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// The main menu lists Draw Things' managed tools and models only on macOS,
// where Draw Things runs. The Layout shell is rendered for real; its panes,
// modals and contexts are stand-ins, since only the menu is under test.

vi.mock('../../../../src/renderer/src/components/PromptPane', () => ({ PromptPane: () => null }))
vi.mock('../../../../src/renderer/src/components/QueueColumn', () => ({ QueueColumn: () => null }))
vi.mock('../../../../src/renderer/src/components/WelcomePane', () => ({ WelcomePane: () => null }))
vi.mock('../../../../src/renderer/src/components/QueueControls', async () => {
  const { MenuItem } = await import('../../../../src/renderer/src/components/Menu')
  return { QueueControlSubmenu: () => <MenuItem onSelect={() => {}}>Queue</MenuItem>, QueuePausedBadge: () => null }
})
vi.mock('../../../../src/renderer/src/components/DependenciesModal', () => ({
  DependenciesModal: () => <div role="dialog" aria-label="Managed tools dialog" />,
}))
vi.mock('../../../../src/renderer/src/hooks/useNotifications', () => ({ useNotifications: () => {} }))
vi.mock('../../../../src/renderer/src/hooks/useVisiblePanes', () => ({ useVisiblePanes: () => ({ panes: [], backends: [] }) }))
vi.mock('../../../../src/renderer/src/context/SelectionContext', () => ({
  useSelection: () => ({ selectedTask: null, clear: vi.fn(), handleSurfaceListKey: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({
  useQueue: () => ({ showKeptImages: false, toggleShowKeptImages: vi.fn() }),
}))
vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    state: { prompt: '' },
    update: vi.fn(),
    draftUnavailable: null,
    retryDraftHydration: vi.fn(),
  }),
}))
vi.mock('../../../../src/renderer/src/context/UiStateContext', () => ({
  useUiState: () => ({ uiState: { columnWidth: null }, patchUiState: vi.fn() }),
}))

const { Layout } = await import('../../../../src/renderer/src/components/Layout')
let forwarded: (command: string) => void = () => {}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openMainMenu(platform: string): void {
  Object.assign(window, {
    electronAPI: {
      platform,
      publishSelection: vi.fn().mockResolvedValue(undefined),
      onFullscreenViewStateChanged: () => () => {},
      onListKey: () => () => {},
      onWindowCommand: (callback: (command: string) => void) => { forwarded = callback; return () => {} },
      reportDialogOpen: vi.fn(async () => undefined),
    },
  })
  render(<Layout />)
  fireEvent.click(screen.getByRole('button', { name: 'Main menu' }))
}

describe('main menu on macOS', () => {
  it('opens the managed tools from its own item', () => {
    openMainMenu('darwin')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Managed tools' }))
    expect(screen.getByRole('dialog', { name: 'Managed tools dialog' })).not.toBeNull()
  })

  it('asks for the Draw Things models from its own item', () => {
    openMainMenu('darwin')
    const opened = vi.fn()
    window.addEventListener('open-models-modal', opened)
    try {
      act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Draw Things Models' })) })
      expect(opened).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('open-models-modal', opened)
    }
  })
})

describe('main menu on Windows', () => {
  it('has neither Draw Things item but keeps the rest of the menu', () => {
    openMainMenu('win32')
    expect(screen.getByRole('menuitem', { name: 'Settings' })).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Managed tools' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Draw Things Models' })).toBeNull()
  })
})

// A shortcut the preview window hands on is answered as if pressed here.
describe('shortcuts handed on by the preview window', () => {
  it('opens the shortcut reference', () => {
    openMainMenu('darwin')
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => forwarded('shortcuts'))
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeNull()
  })

  it('tells the native menu while a dialog is in front', () => {
    openMainMenu('darwin')
    const report = window.electronAPI.reportDialogOpen as ReturnType<typeof vi.fn>
    expect(report).toHaveBeenLastCalledWith(false)
    act(() => forwarded('shortcuts'))
    expect(report).toHaveBeenLastCalledWith(true)
  })
})

