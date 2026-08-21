// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationVolumeSlider } from '../../../../src/renderer/src/components/NotificationVolumeSlider'

afterEach(cleanup)

describe('NotificationVolumeSlider', () => {
  it('commits an arrow-key change', () => {
    const onCommit = vi.fn()
    render(<NotificationVolumeSlider value={0.7} onCommit={onCommit} />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.75' } })
    fireEvent.keyUp(slider, { key: 'ArrowRight' })
    expect(onCommit).toHaveBeenCalledWith(0.75)
  })

  it('commits a pointer drag only once when blur follows', () => {
    const onCommit = vi.fn()
    render(<NotificationVolumeSlider value={0.7} onCommit={onCommit} />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.4' } })
    fireEvent.pointerUp(slider)
    fireEvent.blur(slider)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(0.4)
  })

  it('adopts a value committed by the other surface', () => {
    const { rerender } = render(<NotificationVolumeSlider value={0.7} onCommit={() => {}} />)
    rerender(<NotificationVolumeSlider value={0.2} onCommit={() => {}} />)
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('0.2')
  })
})
