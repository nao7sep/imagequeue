import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  COLUMN_MIN_PX,
  LEFT_PANE_MIN_PX,
} from '../../../../src/shared/layout-metrics'

// CSS cannot import the shared layout metrics, and the scroll-bar styling lives
// in exactly one global block. This test reads the actual CSS text and pins both
// invariants from the window-chrome-conventions:
//   1. styles.css declares the dark color-scheme and a single global, themed,
//      rounded scroll-bar block; CliJobsPanel.css no longer carries its own.
//   2. The pane min-widths mirrored into the CSS match the shared constants the
//      window minimum is derived from, so the two can never silently drift.

const SRC = path.resolve(__dirname, '../../../../src/renderer/src')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf-8')
}

describe('global scroll-bar styling (styles.css)', () => {
  const css = read('styles.css')

  it('declares a dark color-scheme on :root', () => {
    expect(css).toMatch(/color-scheme:\s*dark/)
  })

  it('styles the global ::-webkit-scrollbar with a rounded thumb', () => {
    expect(css).toMatch(/\*::-webkit-scrollbar\s*\{/)
    expect(css).toMatch(/\*::-webkit-scrollbar-thumb\s*\{/)
    // A rounded (pill) thumb, inset via a transparent border clipped to the
    // padding box — the convention's slim-pill recipe.
    const thumbBlock = css.slice(css.indexOf('*::-webkit-scrollbar-thumb'))
    expect(thumbBlock).toMatch(/border-radius:/)
    expect(thumbBlock).toMatch(/border:\s*3px solid transparent/)
    expect(thumbBlock).toMatch(/background-clip:\s*padding-box/)
  })

  it('declares the Firefox thin scroll-bar properties', () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/)
    expect(css).toMatch(/scrollbar-color:/)
  })
})

describe('no scoped scroll-bar styling (CliJobsPanel.css)', () => {
  const css = read('components/CliJobsPanel.css')

  it('no longer defines its own ::-webkit-scrollbar', () => {
    expect(css).not.toMatch(/::-webkit-scrollbar/)
  })
})

describe('pane min-widths mirror the shared constants', () => {
  it('.left-pane min-width matches LEFT_PANE_MIN_PX', () => {
    const css = read('components/Layout.css')
    const block = css.slice(css.indexOf('.left-pane'))
    expect(block).toMatch(new RegExp(`min-width:\\s*${LEFT_PANE_MIN_PX}px`))
  })

  it('.queue-column min-width matches COLUMN_MIN_PX', () => {
    const css = read('components/QueueColumn.css')
    const block = css.slice(css.indexOf('.queue-column'))
    expect(block).toMatch(new RegExp(`min-width:\\s*${COLUMN_MIN_PX}px`))
  })
})
