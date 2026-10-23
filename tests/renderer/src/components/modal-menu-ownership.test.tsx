// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Modal } from '../../../../src/renderer/src/components/Modal'
import { Menu, MenuItem, Submenu } from '../../../../src/renderer/src/components/Menu'

afterEach(cleanup)

async function nextFrame(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
}

function Commands(): React.JSX.Element {
  return <Menu label="Commands" trigger={(props) => <button {...props}>Actions</button>}>
    <Submenu label="More"><MenuItem onSelect={vi.fn()}>Nested</MenuItem><MenuItem onSelect={vi.fn()}>Other nested</MenuItem></Submenu>
    <MenuItem onSelect={vi.fn()}>Last</MenuItem>
  </Menu>
}

function Surface(): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  return open ? <Modal title="Owner" onClose={() => setOpen(false)} footer={<button>Done</button>}>
    <div data-testid="body" style={{ overflowY: 'auto', height: 80 }}><Commands /></div>
  </Modal> : null
}

async function openRoot(): Promise<void> {
  fireEvent.click(screen.getByText('Actions'))
  await nextFrame()
}

async function openSubmenu(): Promise<void> {
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'More' }), { key: 'ArrowRight' })
  await nextFrame()
}

describe('modal menu ownership', () => {
  it('portals both fixed popups inside their dialog and outside its scrolling body, then closes one level per Escape', async () => {
    render(<Surface />)
    await openRoot()
    await openSubmenu()
    const dialog = screen.getByRole('dialog', { name: 'Owner' })
    for (const menu of screen.getAllByRole('menu')) {
      expect(menu.parentElement).toBe(dialog)
      expect(screen.getByTestId('body').contains(menu)).toBe(false)
      expect(menu.style.position).toBe('fixed')
    }
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'More' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'More' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText('Actions'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([false, true])('Tab closes the menu (submenu %s), returns its trigger and leaves the modal trap working', async (nested) => {
    render(<Surface />)
    await openRoot()
    if (nested) await openSubmenu()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText('Actions'))
    screen.getByText('Done').focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it.each([false, true].flatMap((nested) => ['Escape', 'Tab', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].map((key) => ({ nested, key }))))('composing $key preserves focus and dialog (submenu $nested)', async ({ nested, key }) => {
    render(<Surface />)
    await openRoot()
    if (nested) await openSubmenu()
    const focused = document.activeElement
    fireEvent.keyDown(focused!, { key, isComposing: true })
    expect(screen.getAllByRole('menu')).toHaveLength(nested ? 2 : 1)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(document.activeElement).toBe(focused)
  })

  it('guards composing parent navigation and outside-focus global Escape using the native event', async () => {
    render(<Surface />)
    const trigger = screen.getByText('Actions')
    fireEvent.keyDown(trigger, { key: 'ArrowDown', isComposing: true })
    expect(screen.queryByRole('menu')).toBeNull()
    await openRoot()
    const parent = screen.getByRole('menuitem', { name: 'More' })
    fireEvent.keyDown(parent, { key: 'ArrowRight', isComposing: true })
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    screen.getByText('Done').focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText('Done'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it.each([false, true])('a later modal owns Escape even when dismissable is %s', async (dismissable) => {
    const closeLater = vi.fn()
    const view = render(<Surface />)
    await openRoot()
    await openSubmenu()
    const nested = screen.getByText('Nested')
    view.rerender(<><Surface /><Modal title="Later" dismissable={dismissable} onClose={closeLater}><button>Later action</button></Modal></>)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(closeLater).toHaveBeenCalledTimes(dismissable ? 1 : 0)
    expect(screen.getAllByRole('menu')).toHaveLength(2)
    // Even a key dispatched at the obscured popup must not bypass the top modal.
    fireEvent.keyDown(nested, { key: 'Escape' })
    expect(screen.getAllByRole('menu')).toHaveLength(2)
  })

  it.each(['outside', 'global'])('clears submenu state when the root closes through %s dismissal', async (dismissal) => {
    render(<Surface />)
    await openRoot()
    await openSubmenu()
    if (dismissal === 'outside') fireEvent.mouseDown(screen.getByText('Done'))
    else {
      screen.getByText('Done').focus()
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    }
    expect(screen.queryByRole('menu')).toBeNull()
    await openRoot()
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })
})
