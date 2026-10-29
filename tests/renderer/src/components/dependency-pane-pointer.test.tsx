// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DependencyPanePointer } from '../../../../src/renderer/src/components/DependencyPanePointer'
import { DependenciesModal } from '../../../../src/renderer/src/components/DependenciesModal'
import { DependenciesProvider } from '../../../../src/renderer/src/context/DependenciesContext'
import type { DependenciesState, DependencyInfo, RecommendationsInstallResult } from '../../../../src/shared/types'
import { until } from '../../until'

afterEach(cleanup)

function info(id: DependencyInfo['id'], patch: Partial<DependencyInfo>): DependencyInfo {
  return {
    id,
    state: 'up-to-date',
    installedLabel: null,
    entryCount: null,
    latestLabel: null,
    updatedAtUtc: null,
    lastCheckedAtUtc: null,
    ...patch,
  }
}

function renderPointer(state: DependenciesState): void {
  window.electronAPI = {
    getDependenciesState: vi.fn(async () => state),
    cancelDependencyOperation: vi.fn(async () => undefined),
    onDependencyProgress: vi.fn(() => () => undefined),
  } as unknown as typeof window.electronAPI
  render(
    <DependenciesProvider>
      <DependencyPanePointer />
    </DependenciesProvider>,
  )
}

describe('DependencyPanePointer', () => {
  it('states the problem and where to go as one plain paragraph', async () => {
    renderPointer({
      cli: info('cli', { state: 'update-available', installedLabel: 'v1.20260716.0', latestLabel: 'v26.0910.1' }),
      recommendations: info('recommendations', { state: 'up-to-date', entryCount: 56 }),
      checkUpdatesAtLaunch: true,
      platformSupported: true,
    })

    const pointer = await until(() => screen.getByRole('button'))
    expect(pointer.textContent).toBe('A Draw Things CLI update is available. Open Managed tools.')
    expect(pointer.textContent).not.toMatch(/[—–]/)
  })

  it('shows work that continues after Managed tools closes, and only then', async () => {
    const current: DependenciesState = {
      cli: info('cli', { state: 'up-to-date', installedLabel: 'v26.0910.1', latestLabel: 'v26.0910.1' }),
      recommendations: info('recommendations', { state: 'up-to-date', entryCount: 56 }),
      checkUpdatesAtLaunch: true,
      platformSupported: true,
    }
    let finishRefresh: ((result: RecommendationsInstallResult) => void) | undefined
    window.electronAPI = {
      getDependenciesState: vi.fn(async () => current),
      downloadRecommendations: vi.fn(() => new Promise<RecommendationsInstallResult>((resolve) => { finishRefresh = resolve })),
      cancelDependencyOperation: vi.fn(async () => undefined),
      onDependencyProgress: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(true)
      return (
        <DependenciesProvider>
          <DependencyPanePointer />
          {open && <DependenciesModal onClose={() => setOpen(false)} />}
        </DependenciesProvider>
      )
    }
    render(<Harness />)

    fireEvent.click(await until(() => screen.getByRole('button', { name: 'Refresh' })))
    await until(() => screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/being installed or updated/)).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect((await until(() => screen.getByRole('button'))).textContent).toBe('The Draw Things tools are being installed or updated. Open Managed tools.')

    finishRefresh?.({ state: current, warnings: [] })
    await until(() => expect(screen.queryByRole('button')).toBeNull())
  })
})
