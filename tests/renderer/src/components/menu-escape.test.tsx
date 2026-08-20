// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { Menu, MenuItem, Submenu } from '../../../../src/renderer/src/components/Menu'

afterEach(cleanup)

async function openMenu(): Promise<void> {
  fireEvent.click(screen.getByText('open'))
  // The open effect moves focus into the menu on the next frame.
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
}

function renderMenu(): void {
  render(
    <Menu label="Test" trigger={(p) => <button {...p}>open</button>}>
      <MenuItem onSelect={() => {}}>First</MenuItem>
      <MenuItem onSelect={() => {}} disabled>
        Second
      </MenuItem>
    </Menu>,
  )
}

describe('Menu — Escape closes it from anywhere', () => {
  // The two paths differ in more than which listener fires, and the difference is
  // the point: a key aimed at the menu is a keyboard interaction, so focus returns
  // to the trigger and the user keeps navigating; a key from elsewhere must NOT
  // yank the caret out of whatever they were actually typing in.
  it('closes on Escape aimed at the menu, returning focus to the trigger', async () => {
    renderMenu()
    await openMenu()
    expect(screen.queryByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText('open'))
  })

  // The half that was missing. A click outside already dismissed the menu, but an
  // Escape from outside did not — so an open menu whose focus had moved on was
  // the one dismissable surface in the app that ignored the key.
  it('closes when focus has moved out of the menu', async () => {
    renderMenu()
    await openMenu()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(screen.queryByRole('menu')).toBeTruthy()

    fireEvent.keyDown(outside, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    // Focus stays where the user left it — see the pair above.
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('closes on an Escape delivered straight to the document', async () => {
    renderMenu()
    await openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // An Escape another surface has already claimed is not also the menu's. The
  // document listener is global, so without this it would close a menu sitting
  // under anything that handles Escape itself — the keyboard analogue of the
  // outside-click listener refusing clicks that land inside the menu. Simulated
  // the way a layered handler actually behaves: claim the key in the capture
  // phase, before the listener on document sees it.
  it('leaves the menu open when another handler has already claimed the Escape', async () => {
    renderMenu()
    await openMenu()
    const claim = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') e.preventDefault()
    }
    document.addEventListener('keydown', claim, true)
    try {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()
      fireEvent.keyDown(outside, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeTruthy()
      outside.remove()
    } finally {
      document.removeEventListener('keydown', claim, true)
    }
  })

  // One Escape must close ONE level. Submenu's handler calls stopPropagation, so
  // the native event never reaches the document listener — this pins that the
  // new listener cannot collapse the whole menu in a single keystroke.
  it('closes only the submenu when one is open, leaving the parent up', async () => {
    render(
      <Menu label="Test" trigger={(p) => <button {...p}>open</button>}>
        <Submenu label="More">
          <MenuItem onSelect={() => {}}>Nested</MenuItem>
        </Submenu>
        <MenuItem onSelect={() => {}}>First</MenuItem>
      </Menu>,
    )
    await openMenu()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(screen.queryByText('Nested')).toBeTruthy()

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByText('Nested')).toBeNull()
    expect(screen.queryByRole('menu')).toBeTruthy()
  })
})
