// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DependencyPanePointer } from '../../../../src/renderer/src/components/DependencyPanePointer'
import { DependenciesProvider } from '../../../../src/renderer/src/context/DependenciesContext'
import type { DependenciesState, DependencyInfo } from '../../../../src/shared/types'

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
    cancelDependencyOperations: vi.fn(async () => undefined),
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

    const pointer = await screen.findByRole('button')
    expect(pointer.textContent).toBe('A Draw Things CLI update is available. Open Managed tools.')
    expect(pointer.textContent).not.toMatch(/[—–]/)
  })
})
