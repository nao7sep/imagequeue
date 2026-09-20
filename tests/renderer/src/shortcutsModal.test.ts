import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The shortcuts list is the app's tallest read-only surface. Two rules keep it
// inside the window it is read in, and both are easy to undo by accident:
// the shell owns the height bound (a second, tighter one here silently wins),
// and the groups need a definite width to resolve into side-by-side columns.

const layout = readFileSync(resolve('src/renderer/src/components/Layout.css'), 'utf8')
const modal = readFileSync(resolve('src/renderer/src/components/Modal.css'), 'utf8')

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} not found`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('shortcuts modal layout', () => {
  it('leaves the height bound to the modal shell', () => {
    const body = rule(layout, '.shortcuts-body')
    expect(body).not.toMatch(/max-height/)
    expect(body).toMatch(/flex:\s*1/)
    expect(body).toMatch(/min-height:\s*0/)
    expect(body).toMatch(/overflow-y:\s*auto/)
  })

  it('lays the groups out in columns that fall back in a narrow window', () => {
    expect(rule(layout, '.shortcuts-body')).toMatch(
      /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/
    )
  })

  it('gives the box a definite width, which the fractional track needs', () => {
    const box = rule(modal, '.shortcuts-modal-box')
    expect(box).toMatch(/\bwidth:\s*\d+px/)
    expect(box).toMatch(/max-width:\s*\d+vw/)
  })
})
