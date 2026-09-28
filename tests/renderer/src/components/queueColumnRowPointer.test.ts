import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/renderer/src/components/QueueColumn.css'), 'utf8').replace(/\s+/g, '')

// A row is an invisible cover button over its visible card. jsdom has no layout
// or hit testing, so this pins the CSS wiring that makes every point of the card
// behave alike (verified against real Chromium when it was introduced).
describe('queue row pointer and focus wiring', () => {
  it('lets every point of the card but its action buttons reach the cover button', () => {
    expect(css).toMatch(/\.task-visual\{[^}]*pointer-events:none/)
    expect(css).toMatch(/\.task-actions\{[^}]*pointer-events:auto/)
  })

  it('reveals the action group on hover anywhere over the card and while focus is in it', () => {
    expect(css).toMatch(/\.task-row-owner:hover\.task-actions,\.task-row-owner:focus-within\.task-actions\{[^}]*opacity:1/)
  })

  it('gives a clicked row the same focus tint as a keyboard-focused one', () => {
    expect(css).toMatch(/\.task-item:focus~\.task-visual\{/)
    expect(css).not.toMatch(/\.task-item:focus-visible/)
  })
})
