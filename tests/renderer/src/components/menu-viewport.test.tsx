// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Menu, MenuItem, Submenu } from '../../../../src/renderer/src/components/Menu'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }
}

function numericStyle(element: HTMLElement, property: 'left' | 'top'): number {
  const value = Number.parseFloat(element.style[property])
  expect(Number.isFinite(value)).toBe(true)
  return value
}

describe('Menu — viewport-owned popup geometry', () => {
  it('portals both levels beyond clipping ancestors and flips the submenu inside a one-pane viewport', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(551)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('dropdown-menu')) return rect(0, 0, 180, 400)
      if (this.classList.contains('menu-submenu')) return rect(0, 0, 200, 150)
      if (this.classList.contains('menu-submenu-parent')) return rect(340, 300, 180, 30)
      if (this.textContent === 'open') return rect(340, 10, 36, 32)
      return rect(0, 0, 0, 0)
    })

    const { container } = render(
      <div style={{ width: 360, overflow: 'hidden' }}>
        <Menu label="Main" trigger={(props) => <button {...props}>open</button>}>
          <Submenu label="Elaboration">
            <MenuItem onSelect={() => {}}>Elaborators</MenuItem>
          </Submenu>
        </Menu>
      </div>,
    )

    fireEvent.click(screen.getByText('open'))
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    const main = screen.getByRole('menu', { name: 'Main' })
    expect(main.parentElement).toBe(document.body)
    expect(container.contains(main)).toBe(false)
    const mainLeft = numericStyle(main, 'left')
    expect(main.style.position).toBe('fixed')
    expect(mainLeft).toBeGreaterThanOrEqual(8)
    expect(mainLeft + 180).toBeLessThanOrEqual(551 - 8)

    fireEvent.click(screen.getByRole('menuitem', { name: /Elaboration/ }))
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    const submenu = screen.getByRole('menu', { name: 'Elaboration' })
    expect(submenu.parentElement).toBe(document.body)
    expect(container.contains(submenu)).toBe(false)
    const submenuLeft = numericStyle(submenu, 'left')
    const submenuTop = numericStyle(submenu, 'top')
    expect(submenu.style.position).toBe('fixed')
    expect(submenuLeft).toBe(140)
    expect(submenuLeft).toBeGreaterThanOrEqual(8)
    expect(submenuLeft + 200).toBeLessThanOrEqual(551 - 8)
    expect(submenuTop).toBeGreaterThanOrEqual(8)
    expect(submenuTop + 150).toBeLessThanOrEqual(800 - 8)

    // The submenu is no longer a DOM descendant of the root popup. Its owner
    // marker must still make a press inside count as inside, while a genuine
    // outside press closes the whole portalled chain.
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Elaborators' }))
    expect(screen.getByRole('menu', { name: 'Main' })).toBeTruthy()
    expect(screen.getByRole('menu', { name: 'Elaboration' })).toBeTruthy()
    fireEvent.mouseDown(container)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
