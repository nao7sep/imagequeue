// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBrainstormOperation } from '../../../../src/renderer/src/hooks/useBrainstormOperation'

afterEach(() => {
  cleanup()
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  vi.restoreAllMocks()
})

describe('useBrainstormOperation', () => {
  it('reports progress after the Strict Mode setup-cleanup-setup probe', async () => {
    let progressListener: ((event: { done: number; total: number; phase: 'prompts' }) => void) | null = null
    let resolveRun!: (value: { prompts: [] }) => void
    const brainstormPrompts = vi.fn(() => new Promise<{ prompts: [] }>((resolve) => { resolveRun = resolve }))
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        onBrainstormProgress: (_requestId: string, listener: typeof progressListener) => {
          progressListener = listener
          return () => undefined
        },
        brainstormPrompts,
        cancelBrainstorm: vi.fn(),
      },
    })

    const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
      <StrictMode>{children}</StrictMode>
    )
    const { result } = renderHook(() => useBrainstormOperation({
      compositionElaboratorId: 'composition',
      styleElaboratorId: 'style',
      seed: 'seed',
      format: 'sentences',
      length: 'medium',
    }), { wrapper })

    let running!: Promise<unknown>
    act(() => { running = result.current.run(1) })
    expect(result.current.progress).toEqual({ done: 0, total: 1, phase: 'facets' })

    act(() => { progressListener?.({ done: 1, total: 1, phase: 'prompts' }) })
    expect(result.current.progress).toEqual({ done: 1, total: 1, phase: 'prompts' })

    await act(async () => {
      resolveRun({ prompts: [] })
      await running
    })
    expect(result.current.progress).toBeNull()
  })
})
