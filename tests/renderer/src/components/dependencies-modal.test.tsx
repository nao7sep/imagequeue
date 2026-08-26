// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DependenciesModal } from '../../../../src/renderer/src/components/DependenciesModal'
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

describe('DependenciesModal cancellation', () => {
  it('distinguishes an initial load failure from an empty tools list', async () => {
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => { throw new Error('state unavailable') }),
      cancelDependencyOperations: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    render(<DependenciesModal onClose={vi.fn()} />)

    expect(await screen.findByText('state unavailable')).toBeTruthy()
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

    render(<DependenciesModal onClose={vi.fn()} />)

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

    render(<DependenciesModal onClose={onClose} />)
    const installButtons = await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(installButtons[0])
    await waitFor(() => expect(installCli).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel and close' }))

    expect(cancelDependencyOperations).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  }, 15_000)

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

    render(<DependenciesModal onClose={vi.fn()} />)
    await screen.findAllByRole('button', { name: 'Install' })
    fireEvent.click(screen.getByRole('button', { name: 'Check for CLI updates' }))

    expect(await screen.findByText(/Draw Things CLI: offline/)).toBeTruthy()
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

    render(<DependenciesModal onClose={vi.fn()} />)
    const refresh = await screen.findByRole('button', { name: 'Refresh' })
    const recommendationsRow = refresh.closest('section')
    fireEvent.click(refresh)
    await waitFor(() => expect(downloadRecommendations).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog', { name: 'Managed tools' })).toBeTruthy()
    expect(recommendationsRow?.textContent).not.toContain('never checked')
  })
})
