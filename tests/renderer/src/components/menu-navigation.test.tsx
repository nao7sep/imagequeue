// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Menu, MenuItem, Submenu } from '../../../../src/renderer/src/components/Menu'

afterEach(cleanup)

async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function mountMenu(onSelect = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <Menu label="Commands" trigger={(props) => <button {...props}>Open</button>}>
      <MenuItem disabled onSelect={() => onSelect('disabled')}>Unavailable</MenuItem>
      <MenuItem onSelect={() => onSelect('first')}>First</MenuItem>
      <MenuItem disabled onSelect={() => onSelect('disabled')}>Also unavailable</MenuItem>
      <MenuItem onSelect={() => onSelect('second')}>Second</MenuItem>
      <MenuItem onSelect={() => onSelect('third')}>Third</MenuItem>
    </Menu>,
  )
  return onSelect
}

describe('menu navigation targets', () => {
  it('pointer opening starts at the first eligible command and the first arrow moves past disabled commands', async () => {
    mountMenu()
    fireEvent.click(screen.getByText('Open'))
    await nextFrame()
    expect(document.activeElement).toBe(screen.getByText('First'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('Second'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByText('First'))
  })

  it.each([
    { opening: 'ArrowDown', initial: 'First', next: 'ArrowDown', target: 'Second' },
    { opening: 'ArrowUp', initial: 'Third', next: 'ArrowUp', target: 'Second' },
  ])('keyboard $opening opening initializes $initial before the first navigation arrow', async ({ opening, initial, next, target }) => {
    mountMenu()
    const trigger = screen.getByText('Open')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: opening })
    await nextFrame()
    expect(document.activeElement).toBe(screen.getByText(initial))
    fireEvent.keyDown(document.activeElement!, { key: next })
    expect(document.activeElement).toBe(screen.getByText(target))
  })

  it('hovering an earlier command preserves the keyboard target, while clicking acts on the clicked command', async () => {
    const onSelect = mountMenu()
    fireEvent.click(screen.getByText('Open'))
    await nextFrame()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    const first = screen.getByText('First')
    fireEvent.pointerMove(first)
    fireEvent.mouseEnter(first)
    expect(document.activeElement).toBe(screen.getByText('Second'))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('Third'))
    fireEvent.click(first)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('first')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // Enter activates the focused command natively, so the keyboard target is
  // the focused one; hovering after several arrows must not move it.
  it('keeps the keyboard target after several arrows and a hover over an earlier command', async () => {
    mountMenu()
    fireEvent.click(screen.getByText('Open'))
    await nextFrame()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('Third'))
    const first = screen.getByText('First')
    fireEvent.pointerMove(first)
    fireEvent.mouseEnter(first)
    expect(document.activeElement).toBe(screen.getByText('Third'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByText('Second'))
  })

  it('a submenu skips its disabled first command without changing the parent target', async () => {
    render(
      <Menu label="Commands" trigger={(props) => <button {...props}>Open</button>}>
        <Submenu label="More">
          <MenuItem disabled onSelect={vi.fn()}>Unavailable</MenuItem>
          <MenuItem onSelect={vi.fn()}>First nested</MenuItem>
          <MenuItem onSelect={vi.fn()}>Second nested</MenuItem>
        </Submenu>
      </Menu>,
    )
    fireEvent.click(screen.getByText('Open'))
    await nextFrame()
    const parent = document.activeElement
    fireEvent.keyDown(parent!, { key: 'ArrowRight' })
    await nextFrame()
    expect(document.activeElement).toBe(screen.getByText('First nested'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('Second nested'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(parent)
    expect(screen.queryByRole('menu', { name: 'More' })).toBeNull()
  })
})
