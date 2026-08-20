// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Modal } from '../../../../src/renderer/src/components/Modal'

afterEach(cleanup)

// Escape during IME composition belongs to the composition — it cancels the
// pending candidate. The shell's capture-phase handler used to close the modal
// AND swallow the cancel, losing the candidate and the surface at once: the
// one Escape site in the renderer without the guard.
describe('Modal Escape vs IME composition', () => {
  it('leaves the modal open while a composition is pending', () => {
    let closed = 0
    render(
      <Modal title="T" onClose={() => { closed++ }}>
        <input aria-label="field" />
      </Modal>,
    )
    const field = screen.getByLabelText('field')
    field.focus()
    fireEvent.compositionStart(field)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(closed).toBe(0)
    expect(screen.queryByText('T')).toBeTruthy()
  })

  it('closes normally when no composition is pending', () => {
    let closed = 0
    render(
      <Modal title="T" onClose={() => { closed++ }}>
        <input aria-label="field" />
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closed).toBe(1)
  })
})
