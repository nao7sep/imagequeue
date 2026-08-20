import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  COLUMN_DEFAULT_PX,
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

/** The text of ONE rule, sliced to its closing brace — not to end-of-file. A
 *  later rule in the same sheet carrying the right number would otherwise
 *  satisfy the match and hide a stale value in the rule actually under test. */
function rule(file: string, selector: string): string {
  const css = read(file)
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} not found in ${file}`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
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
    expect(rule('components/Layout.css', '.left-pane')).toMatch(
      new RegExp(`min-width:\\s*${LEFT_PANE_MIN_PX}px`),
    )
  })
})

// EVERY element that occupies a column slot mirrors the SAME two numbers, so the
// guard is written per slot rather than per file. It used to be one test per
// `.queue-column` line, and `WelcomePane.css` — which carries both numbers under
// its own keep-in-sync comment — was simply never added, so its copy could go
// stale in silence. Listing the slots makes the next one a single row instead of
// one more thing to remember.
const COLUMN_SLOTS = [
  { file: 'components/QueueColumn.css', selector: '.queue-column' },
  { file: 'components/WelcomePane.css', selector: '.welcome-pane' },
] as const

describe.each(COLUMN_SLOTS)('$selector mirrors the column metrics', ({ file, selector }) => {
  const block = (): string => rule(file, selector)

  it('min-width matches COLUMN_MIN_PX', () => {
    expect(block()).toMatch(new RegExp(`min-width:\\s*${COLUMN_MIN_PX}px`))
  })

  // The SECOND mirrored number: the --iq-column-width fallback is the default
  // width, not the floor, and it is what shows before the renderer sets the
  // variable — so a stale copy here is visible on first paint. Deliberately
  // different values, hence a separate assertion.
  it('--iq-column-width fallback matches COLUMN_DEFAULT_PX', () => {
    expect(block()).toMatch(new RegExp(`var\\(--iq-column-width,\\s*${COLUMN_DEFAULT_PX}px\\)`))
  })
})
