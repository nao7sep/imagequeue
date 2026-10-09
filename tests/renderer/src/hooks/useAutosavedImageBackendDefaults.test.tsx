// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAutosavedImageBackendDefaults } from '../../../../src/renderer/src/hooks/useAutosavedImageBackendDefaults'

it('hands changed defaults to main immediately and does not withdraw them when the column unmounts', async () => {
  let finish!: () => void
  const saveDefaults = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const saved = { model: 'first', params: { width: 1 }, ui: { width: 1 } }
  const applySaved = vi.fn()
  const { rerender, unmount } = renderHook(({ model }) => useAutosavedImageBackendDefaults({
    backend: 'openai', settingsLoaded: true, saved, currentModel: model,
    currentParams: { width: 1 }, applySaved, saveDefaults,
  }), { initialProps: { model: 'first' } })
  expect(saveDefaults).not.toHaveBeenCalled()
  rerender({ model: 'second' })
  expect(saveDefaults).toHaveBeenCalledWith('openai', 'second', { width: 1 })
  unmount()
  await act(async () => { finish() })
  expect(saveDefaults).toHaveBeenCalledOnce()
})

it('submits a revert to the saved value while an earlier change is still saving', () => {
  const saveDefaults = vi.fn((_backend: string, _model: string, _params: Record<string, unknown>) => new Promise<void>(() => undefined))
  const saved = { model: 'first', params: { width: 1 }, ui: { width: 1 } }
  const applySaved = vi.fn()
  const { rerender } = renderHook(({ model }) => useAutosavedImageBackendDefaults({
    backend: 'openai', settingsLoaded: true, saved, currentModel: model,
    currentParams: { width: 1 }, applySaved, saveDefaults,
  }), { initialProps: { model: 'first' } })
  rerender({ model: 'second' })
  rerender({ model: 'first' })
  expect(saveDefaults.mock.calls.map((call) => call[1])).toEqual(['second', 'first'])
})
