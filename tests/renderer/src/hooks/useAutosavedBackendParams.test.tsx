// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAutosavedBackendParams } from '../../../../src/renderer/src/hooks/useAutosavedBackendParams'

it('hands changed defaults to main immediately and does not withdraw them when the column unmounts', async () => {
  let finish!: () => void
  const saveParams = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const saved = { model: 'first', params: { width: 1 }, ui: { width: 1 } }
  const applySaved = vi.fn()
  const { rerender, unmount } = renderHook(({ model }) => useAutosavedBackendParams({
    backend: 'openai', settingsLoaded: true, saved, currentModel: model,
    currentParams: { width: 1 }, applySaved, saveParams,
  }), { initialProps: { model: 'first' } })
  expect(saveParams).not.toHaveBeenCalled()
  rerender({ model: 'second' })
  expect(saveParams).toHaveBeenCalledWith('openai', 'second', { width: 1 })
  unmount()
  await act(async () => { finish() })
  expect(saveParams).toHaveBeenCalledOnce()
})

it('submits a revert to the saved value while an earlier change is still saving', () => {
  const saveParams = vi.fn((_backend: string, _model: string, _params: Record<string, unknown>) => new Promise<void>(() => undefined))
  const saved = { model: 'first', params: { width: 1 }, ui: { width: 1 } }
  const applySaved = vi.fn()
  const { rerender } = renderHook(({ model }) => useAutosavedBackendParams({
    backend: 'openai', settingsLoaded: true, saved, currentModel: model,
    currentParams: { width: 1 }, applySaved, saveParams,
  }), { initialProps: { model: 'first' } })
  rerender({ model: 'second' })
  rerender({ model: 'first' })
  expect(saveParams.mock.calls.map((call) => call[1])).toEqual(['second', 'first'])
})
