import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A setting row's label wraps rather than squeezing its control, so a longer
// translation is never clipped (localization conventions). Measured fit is a
// hand check; this keeps the rules that produce it.

const sheet = (name: string): string => readFileSync(resolve(`src/renderer/src/components/${name}`), 'utf8')

// Every block written for exactly this selector, joined.
function declarations(css: string, selector: string): string {
  return css
    .split('}')
    .filter((block) => block.split('{')[0].trim().split('\n').pop()?.replace(/,$/, '') === selector)
    .join('\n')
}

describe('queue column setting rows', () => {
  const css = sheet('QueueColumn.css')

  it('let a long label wrap within a share of the row and keep the control usable', () => {
    const label = declarations(css, '.setting-row label')
    expect(label).not.toMatch(/white-space:\s*nowrap/)
    expect(label).toMatch(/max-width:\s*\d+%/)
    expect(declarations(css, '.setting-row input')).toMatch(/min-width:\s*[1-9]\d*px/)
  })
})
