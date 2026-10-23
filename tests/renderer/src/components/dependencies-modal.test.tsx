// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DependenciesModal } from '../../../../src/renderer/src/components/DependenciesModal'
import { DependenciesProvider } from '../../../../src/renderer/src/context/DependenciesContext'
import type { DependenciesState, RecommendationsInstallResult } from '../../../../src/shared/types'
import { until } from '../../until'

afterEach(cleanup)

const initialState: DependenciesState = {
  cli: {
    id: 'cli',
    state: 'not-installed',
    installedLabel: null,
    entryCount: null,
    latestLabel: null,
    updatedAtUtc: null,
    lastCheckedAtUtc: null,
  },
  recommendations: {
    id: 'recommendations',
    state: 'not-installed',
    installedLabel: null,
    entryCount: null,
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
  it('retains the installed-recommendations warning through a check until installation repairs it', async () => {
    const installed: DependenciesState = {
      ...initialState,
      recommendations: { ...initialState.recommendations, state: 'installed-unchecked', entryCount: 42 },
    }
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      downloadRecommendations: vi.fn()
        .mockResolvedValueOnce({ state: installed, warnings: ['time-not-saved'] })
        .mockResolvedValueOnce({ state: installed, warnings: [] }),
      checkDependencies: vi.fn(async () => installed),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI
    renderModal()
    fireEvent.click((await until(() => screen.getAllByRole('button', { name: 'Install' })))[1])
    const warning = 'Recommended parameters were installed, but their update date could not be saved.'
    await until(() => expect(screen.getByRole('alert').textContent).toContain(warning))
    expect(screen.getByText(/^42 entries/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await until(() => expect(window.electronAPI.checkDependencies).toHaveBeenCalledOnce())
    await until(() => expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toContain(warning)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await until(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('retains committed installation warnings and clears only check facts repaired by a successful check', async () => {
    const installed: DependenciesState = { ...initialState, cli: { ...initialState.cli, state: 'installed-unchecked' } }
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli: vi.fn(async () => ({ state: installed, warnings: ['identity-unavailable', 'check-not-saved'] })),
      checkDependencies: vi.fn().mockRejectedValueOnce(new Error('SECRET_SENTINEL')).mockResolvedValueOnce(installed),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI
    renderModal()
    fireEvent.click((await until(() => screen.getAllByRole('button', { name: 'Install' })))[0])
    await until(() => {
      expect(screen.getByRole('alert').textContent).toContain('Draw Things CLI was installed, but its version is unavailable.')
      expect(screen.getByRole('alert').textContent).toContain('update-check information could not be saved')
      expect(screen.getByText(/^Version unreadable/)).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await until(() => {
      expect(screen.getByRole('alert').textContent).toContain('update-check information could not be saved')
      expect(screen.getByRole('alert').textContent).toContain('The managed-tool operation could not be completed')
      expect(screen.getByRole('alert').textContent).not.toContain('SECRET_SENTINEL')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await until(() => {
      expect(screen.getByRole('alert').textContent).toContain('its version is unavailable')
      expect(screen.getByRole('alert').textContent).not.toContain('update-check information could not be saved')
    })
  })

  it('keeps the window after a check when no install has left warnings', async () => {
    const checked: DependenciesState = { ...initialState, cli: { ...initialState.cli, lastCheckedAtUtc: '2026-10-22T00:00:00.000Z' } }
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      checkDependencies: vi.fn(async () => checked),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI
    renderModal()
    fireEvent.click(await until(() => screen.getByRole('button', { name: 'Check for updates' })))
    await until(() => expect(window.electronAPI.checkDependencies).toHaveBeenCalled())
    await until(() => expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('refreshes recommendation facts as well as CLI facts after Check all', async () => {
    const checked: DependenciesState = {
      ...initialState,
      recommendations: { ...initialState.recommendations, state: 'installed-unchecked', entryCount: 7 },
    }
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      checkDependencies: vi.fn(async () => checked),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI
    renderModal()
    fireEvent.click(await until(() => screen.getByRole('button', { name: 'Check for updates' })))
    await until(() => expect(screen.getByText('7 entries')).toBeTruthy())
  })

  it('emphasizes required absence without coloring optional absence as a warning', async () => {
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()

    const cliRow = (await until(() => screen.getByRole('heading', { name: 'Draw Things CLI' }))).closest('section')
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
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()

    expect((await until(() => screen.getByRole('alert'))).textContent).toContain('Managed tools could not be checked')
    expect(screen.getByRole('alert').textContent).not.toContain('state unavailable')
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
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()

    expect(await until(() => screen.getByText(/^Version unreadable/))).toBeTruthy()
    expect(screen.queryByText(/^version unreadable/)).toBeNull()
  })

  it('closes by every path without cancelling the running work', async () => {
    const cancelDependencyOperation = vi.fn(async () => undefined)
    const installCli = vi.fn(() => new Promise<DependenciesState>(() => undefined))
    const onClose = vi.fn()
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli,
      cancelDependencyOperation,
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal(onClose)
    fireEvent.click((await until(() => screen.getAllByRole('button', { name: 'Install' })))[0])
    await until(() => expect(installCli).toHaveBeenCalledTimes(1))

    const dialog = screen.getByRole('dialog', { name: 'Managed tools' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
    expect(cancelDependencyOperation).not.toHaveBeenCalled()
  })

  it('cancels only the row whose Cancel was pressed, and the check through its own Cancel', async () => {
    let rejectInstall: ((error: Error) => void) | undefined
    const installCli = vi.fn(() => new Promise<DependenciesState>((_resolve, reject) => {
      rejectInstall = reject
    }))
    let rejectCheck: ((error: Error) => void) | undefined
    const checkDependencies = vi.fn(() => new Promise<DependenciesState>((_resolve, reject) => {
      rejectCheck = reject
    }))
    const cancelDependencyOperation = vi.fn(async (dependency: string) => {
      if (installCli.mock.calls.length > 0 && rejectInstall) {
        rejectInstall(new Error('cancelled'))
        rejectInstall = undefined
      } else rejectCheck?.(new Error('cancelled'))
      return dependency
    })
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli,
      checkDependencies,
      cancelDependencyOperation,
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()
    const cliRow = (await until(() => screen.getByRole('heading', { name: 'Draw Things CLI' }))).closest('section') as HTMLElement
    fireEvent.click(within(cliRow).getByRole('button', { name: 'Install' }))
    fireEvent.click(await until(() => within(cliRow).getByRole('button', { name: 'Cancel' })))
    await until(() => expect(within(cliRow).getByText('Cancelled')).toBeTruthy())
    expect(cancelDependencyOperation).toHaveBeenLastCalledWith('cli')
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    fireEvent.click(await until(() => screen.getByRole('button', { name: 'Cancel check' })))
    await until(() => expect(screen.getByText('Check cancelled')).toBeTruthy())
    expect(cancelDependencyOperation).toHaveBeenCalledTimes(2)
  })

  it('shows an explicit CLI check failure and re-reads local state', async () => {
    const getDependenciesState = vi.fn(async () => initialState)
    const checkDependencies = vi.fn(async (): Promise<DependenciesState> => {
      throw new Error('Could not check dependencies. Draw Things CLI: offline')
    })
    const api = {
      getDependenciesState,
      checkDependencies,
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    }
    window.electronAPI = api as unknown as typeof window.electronAPI

    renderModal()
    await until(() => screen.getAllByRole('button', { name: 'Install' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    expect((await until(() => screen.getByRole('alert'))).textContent).toContain('managed-tool operation could not be completed')
    expect(screen.getByRole('alert').textContent).not.toContain('Draw Things CLI: offline')
    expect(getDependenciesState).toHaveBeenCalledTimes(2)
  })

  it('records a hostile reconciliation failure separately from the authored operation result', async () => {
    const reconciliation = new Error('EACCES /private/tmp/IMAGEQUEUE_RECONCILE_SENTINEL')
    const getDependenciesState = vi.fn()
      .mockResolvedValueOnce(initialState)
      .mockRejectedValueOnce(reconciliation)
    const appLog = vi.fn(async () => undefined)
    window.electronAPI = {
      getDependenciesState,
      checkDependencies: vi.fn(async (): Promise<DependenciesState> => {
        throw new Error('managed tool operation failed')
      }),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
      appLog,
    } as unknown as typeof window.electronAPI

    renderModal()
    await until(() => screen.getAllByRole('button', { name: 'Install' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    const result = await until(() => screen.getByRole('alert'))
    expect(result.textContent).toContain('managed-tool operation could not be completed')
    expect(result.textContent).not.toContain('IMAGEQUEUE_RECONCILE_SENTINEL')
    expect(appLog).toHaveBeenCalledWith(
      'error',
      'Failed to reconcile managed-tool state after an operation',
      expect.objectContaining({ operation: 'check', error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_RECONCILE_SENTINEL') }) }),
    )
  })

  it('offers an explicit Refresh for installed versionless recommendations', async () => {
    const installed = {
      ...initialState,
      recommendations: {
        ...initialState.recommendations,
        state: 'installed-unchecked' as const,
        entryCount: 42,
      },
    }
    const downloadRecommendations = vi.fn(async () => ({ state: installed, warnings: [] }))
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => installed),
      downloadRecommendations,
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()
    const refresh = await until(() => screen.getByRole('button', { name: 'Refresh' }))
    const recommendationsRow = refresh.closest('section')
    fireEvent.click(refresh)
    await until(() => expect(downloadRecommendations).toHaveBeenCalledTimes(1))
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
      cancelDependencyOperation: vi.fn(async () => undefined),
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
    const installButtons = await until(() => screen.getAllByRole('button', { name: 'Install' }))
    fireEvent.click(installButtons[0])
    await until(() => expect(installCli).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Replace view' }))
    finishInstall?.(installed)
    await until(() => expect(screen.queryByRole('dialog', { name: 'Managed tools' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await until(() => screen.getByText(/^1\.2\.3/))).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Install' })).toHaveLength(1)
  })

  it('retains a terminal operation failure across close and reopen', async () => {
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      checkDependencies: vi.fn(async (): Promise<DependenciesState> => {
        throw new Error('CLI service unavailable')
      }),
      cancelDependencyOperation: vi.fn(async () => undefined),
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
    await until(() => screen.getAllByRole('button', { name: 'Install' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await until(() => screen.getByText(/managed-tool operation could not be completed/))).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await until(() => screen.getByText(/managed-tool operation could not be completed/))).toBeTruthy()
    expect(screen.queryByText('CLI service unavailable')).toBeNull()
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
        entryCount: 24,
      },
    }
    let finishCli: ((state: DependenciesState) => void) | undefined
    let finishRecommendations: ((result: RecommendationsInstallResult) => void) | undefined
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => initialState),
      installCli: vi.fn(() => new Promise<DependenciesState>((resolve) => {
        finishCli = resolve
      })),
      downloadRecommendations: vi.fn(() => new Promise<RecommendationsInstallResult>((resolve) => {
        finishRecommendations = resolve
      })),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()
    const installButtons = await until(() => screen.getAllByRole('button', { name: 'Install' }))
    fireEvent.click(installButtons[0])
    fireEvent.click(installButtons[1])
    finishCli?.(cliInstalled)
    await until(() => screen.getByText(/^2\.0\.0/))
    finishRecommendations?.({ state: recommendationsInstalled, warnings: [] })

    expect(await until(() => screen.getByText(/^24 entries/))).toBeTruthy()
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
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    renderModal()
    const installButtons = await until(() => screen.getAllByRole('button', { name: 'Install' }))
    window.dispatchEvent(new Event('focus'))
    await until(() => expect(getDependenciesState).toHaveBeenCalledTimes(2))
    fireEvent.click(installButtons[0])
    expect(await until(() => screen.getByText(/^3\.0\.0/))).toBeTruthy()
    finishStaleRefresh?.(initialState)

    await until(() => {
      expect(screen.getByText(/^3\.0\.0/)).toBeTruthy()
      expect(screen.getAllByRole('button', { name: 'Install' })).toHaveLength(1)
    })
  })
})

describe('DependenciesModal checking', () => {
  function stateWith(patch: {
    cli?: Partial<DependenciesState['cli']>
    recommendations?: Partial<DependenciesState['recommendations']>
  }): DependenciesState {
    return {
      ...initialState,
      cli: { ...initialState.cli, ...patch.cli },
      recommendations: { ...initialState.recommendations, ...patch.recommendations },
    }
  }

  function mockState(state: DependenciesState): void {
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => state),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI
  }

  it('offers Update for recommended parameters the server has changed since', async () => {
    mockState(stateWith({
      cli: { state: 'up-to-date', installedLabel: 'v26.0910.1', lastCheckedAtUtc: '2026-09-19T09:00:00.000Z' },
      recommendations: {
        state: 'update-available',
        entryCount: 54,
        updatedAtUtc: '2026-08-22T20:13:13.000Z',
        lastCheckedAtUtc: '2026-09-19T09:00:00.000Z',
      },
    }))
    renderModal()

    const row = (await until(() => screen.getByRole('heading', { name: 'Recommended parameters' }))).closest('section')
    expect(within(row as HTMLElement).getByText('Update available', { selector: '.dependency-badge' })).toBeTruthy()
    expect(within(row as HTMLElement).getByRole('button', { name: 'Update' })).toBeTruthy()
    expect(within(row as HTMLElement).queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('dates the set by its least recently checked tool, and reads Never while one is unchecked', async () => {
    mockState(stateWith({
      cli: { state: 'up-to-date', installedLabel: 'v26.0910.1', lastCheckedAtUtc: '2026-09-19T09:00:00.000Z' },
      recommendations: { state: 'installed-unchecked', entryCount: 54, lastCheckedAtUtc: null },
    }))
    renderModal()

    const updates = (await until(() => screen.getByRole('heading', { name: 'Updates' }))).closest('section') as HTMLElement
    expect(within(updates).getByText('Never')).toBeTruthy()
    expect(within(updates).getByRole('button', { name: 'Check for updates' })).toBeTruthy()
    expect(within(updates).getByRole('checkbox', { name: 'Check for updates at launch' })).toBeTruthy()
  })
})
