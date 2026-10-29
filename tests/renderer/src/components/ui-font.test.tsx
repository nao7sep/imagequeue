// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiFont } from '../../../../src/renderer/src/components/UiFont'
import { until } from '../../until'

const font = () => document.documentElement.style.getPropertyValue('--font-ui')
afterEach(() => { cleanup(); document.documentElement.style.removeProperty('--font-ui') })

function boundary(getSettings: () => Promise<unknown>) {
  let change = (_family: string) => {}
  const unsubscribe = vi.fn()
  window.electronAPI = {
    getSettings,
    onUiFontChanged: (callback: (family: string) => void) => { change = callback; return unsubscribe },
  } as unknown as typeof window.electronAPI
  return { change: (family: string) => act(() => change(family)), unsubscribe }
}

describe('shared window font', () => {
  it('hydrates without credentials, follows saved changes, and clears a custom font', async () => {
    const b = boundary(async () => ({ general: { ui_font_family: ' Custom Font ' } }))
    const view = render(<UiFont />)
    await until(() => expect(font()).toBe('Custom Font'))
    b.change('Another Font')
    expect(font()).toBe('Another Font')
    b.change('')
    expect(font()).toBe('')
    view.unmount()
    expect(b.unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not let delayed hydration overwrite a newer saved font', async () => {
    let resolve!: (value: unknown) => void
    const b = boundary(() => new Promise((done) => { resolve = done }))
    render(<UiFont />)
    b.change('New Font')
    await act(async () => resolve({ general: { ui_font_family: 'Old Font' } }))
    expect(font()).toBe('New Font')
  })

  it('keeps the default usable when startup recovery has no readable settings', async () => {
    boundary(async () => { throw new Error('settings unavailable') })
    render(<UiFont />)
    await act(async () => {})
    expect(font()).toBe('')
  })
})
