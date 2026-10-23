// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MODAL_OPERATION_WAIT_MS, useModalOperation } from '../../../../src/renderer/src/hooks/useModalOperation'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('ends the caller wait but keeps the physical claim and ignores a late start notification after settlement', async () => {
  vi.useFakeTimers()
  const close = vi.fn()
  const retain = vi.fn()
  const failure = vi.fn()
  const { result, rerender } = renderHook(({ visible }) => useModalOperation({ visible, onClose: close, retain }), {
    initialProps: { visible: true },
  })
  let finish!: () => void
  let start!: () => void
  let caller!: Promise<void>
  act(() => {
    caller = result.current.run(async (startWait) => {
      start = startWait
      startWait()
      await new Promise<void>((resolve) => { finish = resolve })
      return 'close'
    }, failure)
  })
  await act(async () => vi.advanceTimersByTimeAsync(MODAL_OPERATION_WAIT_MS))
  await expect(caller).resolves.toBeUndefined()
  expect(result.current.busyRef.current).toBe(true)
  expect(result.current.pending).toBe(true)
  const duplicate = vi.fn()
  await act(async () => result.current.run(duplicate, failure))
  expect(duplicate).not.toHaveBeenCalled()
  rerender({ visible: false })
  await act(async () => finish())
  expect(result.current.busy).toBe(false)
  expect(retain).toHaveBeenLastCalledWith(null)
  expect(close).not.toHaveBeenCalled()
  start()
  await act(async () => vi.advanceTimersByTimeAsync(MODAL_OPERATION_WAIT_MS))
  expect(result.current.pending).toBe(false)
  expect(failure).not.toHaveBeenCalled()
})
