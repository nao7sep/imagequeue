// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DependenciesModal } from '../../../../src/renderer/src/components/DependenciesModal'
import { DependenciesProvider } from '../../../../src/renderer/src/context/DependenciesContext'
import type { DependenciesState } from '../../../../src/shared/types'

afterEach(cleanup)

const initialState: DependenciesState = {
  cli: {
    id: 'cli',
    state: 'not-installed',
    installedLabel: null,
    latestLabel: null,
    updatedAtUtc: null,
    lastCheckedAtUtc: null,
  },
  recommendations: {
    id: 'recommendations',
    state: 'not-installed',
    installedLabel: null,
    latestLabel: null,
    updatedAtUtc: null,
    lastCheckedAtUtc: null,
  },
  checkUpdatesAtLaunch: true,
  platformSupported: true,
}

function renderModal(onClose = vi.fn()): ReturnType<typeof render> {
  return render(
    <DependenciesProvider>
      <DependenciesModal onClose={onClose} />
    </DependenciesProvider>,
  )
}

describe('DependenciesModal cancellation', () => {
  it('emphasizes required absence without coloring optional absence as a warning', async () => {
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()

    const cliRow = (await screen.findByRole('heading', { name: 'Draw Things CLI' })).closest('section')
    const recommendationsRow = screen.getByRole('heading', { name: 'Recommended parameters' }).closest('section')
    expect(cliRow).not.toBeNull()
    expect(recommendationsRow).not.toBeNull()

    const cliStatus = within(cliRow as HTMLElement).getByText('Not installed', {
      selector: '.dependency-badge',
    })
    const recommendationsStatus = within(recommendationsRow as HTMLElement).getByText(
      'Not installed',
      { selector: '.dependency-badge' },
    )
    expect(cliStatus.classList.contains('dependency-badge-required')).toBe(true)
    expect(recommendationsStatus.classList.contains('dependency-badge-required')).toBe(false)
    expect(recommendationsRow?.textContent).toContain('Optional')
  })

  it('distinguishes an initial load failure from an empty tools list', async () => {
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => { throw new Error('state unavailable') }),
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()

    expect((await screen.findByRole('alert')).textContent).toContain('state unavailable')
    expect(screen.getByText('Couldn’t load managed-tool status.')).toBeTruthy()
  })

  it('capitalizes the unavailable installed-version state', async () => {
    const unreadable = {
      ...initialState,
      cli: {
        ...initialState.cli,
        state: 'installed-unchecked' as const,
      },
    }
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => unreadable),
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()

    expect(await screen.findByText(/^Version unreadable/)).toBeTruthy()
    expect(screen.queryByText(/^version unreadable/)).toBeNull()
  })

  it('cancels active acquisition and closes instead of trapping the user', async () => {
    const cancelDependencyOperations = vi.fn(async () => undefined)
    const installCli = vi.fn(() => new Promise<DependenciesState>(() => undefined))
    const onClose = vi.fn()
    const api = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli,
      cancelDependencyOperations,
      onDependencyProgress: vi.fn(() => () => undefined),
    }
    window.electronAPI = api as unknown as typeof window.electronAPI

    renderModal(onClose)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0])
    await waitFor(() => expect(installCli).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel and close' }))

    expect(cancelDependencyOperations).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('retains cancellation across close and reopen until the matching retry', async () => {
    let rejectInstall: ((error: Error) => void) | undefined
    const installCli = vi.fn(() => new Promise<DependenciesState>((_resolve, reject) => {
      rejectInstall = reject
    }))
    const cancelDependencyOperations = vi.fn(async () => {
      rejectInstall?.(new Error('cancelled'))
    })
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli,
      cancelDependencyOperations,
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(true)
      return (
        <DependenciesProvider>
          <button type="button" onClick={() => setOpen(true)}>Reopen</button>
          {open && <DependenciesModal onClose={() => setOpen(false)} />}
        </DependenciesProvider>
      )
    }

    render(<Harness />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0])
    await waitFor(() => expect(installCli).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and close' }))
    await waitFor(() => expect(cancelDependencyOperations).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await screen.findByRole('status')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[0])
    expect(screen.queryByText('Cancelled')).toBeNull()
  })

  it('shows an explicit CLI check failure and re-reads local state', async () => {
    const getDependenciesState = vi.fn(async () => initialState)
    const checkDependencies = vi.fn(async (): Promise<DependenciesState> => {
      throw new Error('Could not check dependencies. Draw Things CLI: offline')
    })
    const api = {
      getDependenciesState,
      checkDependencies,
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    }
    window.electronAPI = api as unknown as typeof window.electronAPI

    renderModal()
    await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(screen.getByRole('button', { name: 'Check for CLI updates' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Draw Things CLI: offline')
    expect(getDependenciesState).toHaveBeenCalledTimes(2)
  })

  it('offers an explicit Refresh for installed versionless recommendations', async () => {
    const installed = {
      ...initialState,
      recommendations: {
        ...initialState.recommendations,
        state: 'installed-unchecked' as const,
        installedLabel: '42 entries',
      },
    }
    const downloadRecommendations = vi.fn(async () => installed)
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => installed),
      downloadRecommendations,
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()
    const refresh = await screen.findByRole('button', { name: 'Refresh' })
    const recommendationsRow = refresh.closest('section')
    fireEvent.click(refresh)
    await waitFor(() => expect(downloadRecommendations).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog', { name: 'Managed tools' })).toBeTruthy()
    expect(recommendationsRow?.textContent).not.toContain('never checked')
  })

  it('keeps a terminal result when the replaceable modal unmounts mid-operation', async () => {
    const installed: DependenciesState = {
      ...initialState,
      cli: {
        ...initialState.cli,
        state: 'up-to-date',
        installedLabel: '1.2.3',
        latestLabel: '1.2.3',
      },
    }
    let finishInstall: ((state: DependenciesState) => void) | undefined
    const installCli = vi.fn(() => new Promise<DependenciesState>((resolve) => {
      finishInstall = resolve
    }))
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli,
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(true)
      return (
        <DependenciesProvider>
          <button type="button" onClick={() => setOpen(false)}>Replace view</button>
          <button type="button" onClick={() => setOpen(true)}>Reopen</button>
          {open && <DependenciesModal onClose={() => setOpen(false)} />}
        </DependenciesProvider>
      )
    }

    render(<Harness />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0])
    await waitFor(() => expect(installCli).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Replace view' }))
    finishInstall?.(installed)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Managed tools' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await screen.findByText(/^1\.2\.3/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Install' })).toHaveLength(1)
  })

  it('retains a terminal operation failure across close and reopen', async () => {
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      checkDependencies: vi.fn(async (): Promise<DependenciesState> => {
        throw new Error('CLI service unavailable')
      }),
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(true)
      return (
        <DependenciesProvider>
          <button type="button" onClick={() => setOpen(true)}>Reopen</button>
          {open && <DependenciesModal onClose={() => setOpen(false)} />}
        </DependenciesProvider>
      )
    }

    render(<Harness />)
    await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(screen.getByRole('button', { name: 'Check for CLI updates' }))
    expect(await screen.findByText('CLI service unavailable')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await screen.findByText('CLI service unavailable')).toBeTruthy()
  })

  it('merges concurrent independent operation results without losing either fact', async () => {
    const cliInstalled: DependenciesState = {
      ...initialState,
      cli: {
        ...initialState.cli,
        state: 'up-to-date',
        installedLabel: '2.0.0',
        latestLabel: '2.0.0',
      },
    }
    const recommendationsInstalled: DependenciesState = {
      ...initialState,
      recommendations: {
        ...initialState.recommendations,
        state: 'installed-unchecked',
        installedLabel: '24 entries',
      },
    }
    let finishCli: ((state: DependenciesState) => void) | undefined
    let finishRecommendations: ((state: DependenciesState) => void) | undefined
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli: vi.fn(() => new Promise<DependenciesState>((resolve) => {
        finishCli = resolve
      })),
      downloadRecommendations: vi.fn(() => new Promise<DependenciesState>((resolve) => {
        finishRecommendations = resolve
      })),
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0])
    fireEvent.click(installButtons[1])
    finishCli?.(cliInstalled)
    await screen.findByText(/^2\.0\.0/)
    finishRecommendations?.(recommendationsInstalled)

    expect(await screen.findByText(/^24 entries/)).toBeTruthy()
    expect(screen.getByText(/^2\.0\.0/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })

  it('does not let an older focus refresh restore a stale completed action', async () => {
    const installed: DependenciesState = {
      ...initialState,
      cli: {
        ...initialState.cli,
        state: 'up-to-date',
        installedLabel: '3.0.0',
        latestLabel: '3.0.0',
      },
    }
    let finishStaleRefresh: ((state: DependenciesState) => void) | undefined
    const getDependenciesState = vi.fn()
      .mockResolvedValueOnce(initialState)
      .mockImplementationOnce(() => new Promise<DependenciesState>((resolve) => {
        finishStaleRefresh = resolve
      }))
    window.electronAPI = {
      getDependenciesState,
      installCli: vi.fn(async () => installed),
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(getDependenciesState).toHaveBeenCalledTimes(2))
    fireEvent.click(installButtons[0])
    expect(await screen.findByText(/^3\.0\.0/)).toBeTruthy()
    finishStaleRefresh?.(initialState)

    await waitFor(() => {
      expect(screen.getByText(/^3\.0\.0/)).toBeTruthy()
      expect(screen.getAllByRole('button', { name: 'Install' })).toHaveLength(1)
    })
  })
})
