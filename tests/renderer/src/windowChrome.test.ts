import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  COLUMN_DEFAULT_PX,
  COLUMN_MAX_PX,
  COLUMN_MIN_PX,
  LEFT_PANE_MIN_PX,
} from '../../../src/shared/layout-metrics'

const SRC = path.resolve(__dirname, '../../../src/renderer/src')

function rule(file: string, selector: string): string {
  const css = fs.readFileSync(path.join(SRC, file), 'utf-8')
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} not found in ${file}`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

const CSS_LAYOUT_MIRRORS = [
  {
    file: 'components/Layout.css',
    selector: '.left-pane',
    pattern: new RegExp(`min-width:\\s*${LEFT_PANE_MIN_PX}px`),
  },
  ...[
    { file: 'components/QueueColumn.css', selector: '.queue-column' },
    { file: 'components/WelcomePane.css', selector: '.welcome-pane' },
  ].flatMap(({ file, selector }) => [
    { file, selector, pattern: new RegExp(`min-width:\\s*${COLUMN_MIN_PX}px`) },
    { file, selector, pattern: new RegExp(`max-width:\\s*${COLUMN_MAX_PX}px`) },
    {
      file,
      selector,
      pattern: new RegExp(`var\\(--iq-column-width,\\s*${COLUMN_DEFAULT_PX}px\\)`),
    },
  ]),
]

describe('CSS layout metrics', () => {
  it('mirror the shared window-sizing constants', () => {
    for (const { file, selector, pattern } of CSS_LAYOUT_MIRRORS) {
      expect(rule(file, selector), `${selector} in ${file}`).toMatch(pattern)
    }
  })
})
