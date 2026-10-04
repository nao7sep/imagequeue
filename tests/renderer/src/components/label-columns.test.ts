import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Label columns fit their content and wrap only past a cap, never a fixed width
// a longer translation would clip (localization conventions). Measured fit is a
// hand check; these keep the rules that produce it.

const sheet = (name: string): string => readFileSync(resolve(`src/renderer/src/components/${name}`), 'utf8')

// Every block written for exactly this selector, joined.
function declarations(css: string, selector: string): string {
  return css
    .split('}')
    .filter((block) => block.split('{')[0].trim().split('\n').pop()?.replace(/,$/, '') === selector)
    .join('\n')
}

describe('settings label column', () => {
  const css = sheet('SettingsModal.css')

  it('is one content-sized, capped column per section that every field shares', () => {
    expect(declarations(css, '.settings-section')).toMatch(/grid-template-columns:\s*fit-content\(\d+%\) minmax\(0, 1fr\)/)
    expect(declarations(css, '.settings-field')).toMatch(/grid-template-columns:\s*subgrid/)
    expect(declarations(css, '.settings-subsection')).toMatch(/grid-template-columns:\s*subgrid/)
    expect(css).not.toMatch(/grid-template-columns:\s*\d+px/)
  })
})

describe('elaboration settings label column', () => {
  const css = sheet('ElaborationSettingsModal.css')

  it('fits its labels up to a cap and its inputs, shared by every row', () => {
    expect(declarations(css, '.elaboration-settings-fields')).toMatch(/grid-template-columns:\s*fit-content\(\d+%\) auto minmax\(0, 1fr\)/)
    expect(declarations(css, '.elaboration-settings-row')).toMatch(/grid-template-columns:\s*subgrid/)
    expect(css).not.toMatch(/grid-template-columns:\s*\d+px/)
  })
})
