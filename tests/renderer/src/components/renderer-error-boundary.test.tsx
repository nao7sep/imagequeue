// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RendererErrorBoundary } from '../../../../src/renderer/src/components/RendererErrorBoundary'

const HOSTILE = 'EACCES /Users/nao/.imagequeue/quarantine/internal-state.json'

function Broken(): React.JSX.Element {
  throw new Error(HOSTILE)
}

describe('RendererErrorBoundary', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { appLog: vi.fn().mockResolvedValue(undefined) },
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('owns a render failure without exposing its diagnostic', () => {
    render(<RendererErrorBoundary><Broken /></RendererErrorBoundary>)

    expect(screen.getByRole('alert').textContent).toContain('ImageQueue could not keep this window open.')
    expect(screen.queryByText(HOSTILE, { exact: false })).toBeNull()
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error',
      'Renderer stopped unexpectedly',
      expect.objectContaining({ error: expect.objectContaining({ message: HOSTILE }) }),
    )
  })
})
