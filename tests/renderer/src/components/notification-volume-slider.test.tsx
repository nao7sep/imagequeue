// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiStateProvider, useUiState } from '../../../../src/renderer/src/context/UiStateContext'
import { defaultUiState } from '../../../../src/shared/ui-state'
import { OPERATIONAL_FAILURE_EVENT } from '../../../../src/renderer/src/utils/operationalFailure'
import { NotificationVolumeSlider } from '../../../../src/renderer/src/components/NotificationVolumeSlider'

afterEach(cleanup)

describe('NotificationVolumeSlider', () => {
  it('commits an arrow-key change', () => {
    const onCommit = vi.fn(async () => true)
    render(<NotificationVolumeSlider value={0.7} onCommit={onCommit} />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.75' } })
    fireEvent.keyUp(slider, { key: 'ArrowRight' })
    expect(onCommit).toHaveBeenCalledWith(0.75)
  })

  it('commits a pointer drag only once when blur follows', () => {
    const onCommit = vi.fn(async () => true)
    render(<NotificationVolumeSlider value={0.7} onCommit={onCommit} />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.4' } })
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(0.4)
  })

  it('adopts a value committed by the other surface', () => {
    const { rerender } = render(<NotificationVolumeSlider value={0.7} onCommit={async () => true} />)
    rerender(<NotificationVolumeSlider value={0.2} onCommit={async () => true} />)
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('0.2')
  })
})


it.each([0.2, 0.7])('preserves the next drag to %s when the prior acknowledgement arrives', async (next) => {
  let acknowledge!: (saved: boolean) => void
  const onCommit = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { acknowledge = resolve })).mockResolvedValue(true)
  const { rerender } = render(<NotificationVolumeSlider value={0.7} onCommit={onCommit} />)
  const slider = screen.getByRole('slider') as HTMLInputElement
  fireEvent.change(slider, { target: { value: '0.4' } })
  fireEvent.pointerUp(slider)
  fireEvent.change(slider, { target: { value: String(next) } })
  await act(async () => { rerender(<NotificationVolumeSlider value={0.4} onCommit={onCommit} />); acknowledge(true) })
  expect(slider.value).toBe(String(next))
  await act(async () => fireEvent.pointerUp(slider))
  expect(onCommit.mock.calls).toEqual([[0.4], [next]])
})

it('retains a failed draft and allows retry without another adjustment', async () => {
  const onCommit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  render(<NotificationVolumeSlider value={0.7} onCommit={onCommit} />)
  const slider = screen.getByRole('slider') as HTMLInputElement
  fireEvent.change(slider, { target: { value: '0.4' } })
  await act(async () => fireEvent.pointerUp(slider))
  expect(slider.value).toBe('0.4')
  await act(async () => fireEvent.pointerUp(slider))
  expect(onCommit.mock.calls).toEqual([[0.4], [0.4]])
  fireEvent.blur(slider)
  expect(onCommit).toHaveBeenCalledTimes(2)
})


it('uses the real UI-state writer acknowledgement and retains its failed-save notice', async () => {
  const failure = vi.fn()
  window.addEventListener(OPERATIONAL_FAILURE_EVENT, failure)
  const update = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(defaultUiState)
  window.electronAPI = {
    getUiState: vi.fn(async () => defaultUiState), updateUiState: update, appLog: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI
  function Volume(): React.JSX.Element {
    const { uiState, patchUiState } = useUiState()
    return <NotificationVolumeSlider value={uiState.notificationVolume} onCommit={(notificationVolume) => patchUiState({ notificationVolume })} />
  }
  try {
    await act(async () => { render(<UiStateProvider><Volume /></UiStateProvider>) })
    const slider = screen.getByRole('slider') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0.4' } })
    await act(async () => fireEvent.pointerUp(slider))
    expect(failure).toHaveBeenCalledOnce()
    expect(slider.value).toBe('0.4')
    await act(async () => fireEvent.pointerUp(slider))
    expect(update.mock.calls).toEqual([[{ notificationVolume: 0.4 }], [{ notificationVolume: 0.4 }]])
    expect(slider.value).toBe('0.4')
  } finally { window.removeEventListener(OPERATIONAL_FAILURE_EVENT, failure) }
})
