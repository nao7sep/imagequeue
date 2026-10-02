import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Dialog band lines take the control-edge colour (modal-dialog conventions).

const sheets = {
  modal: readFileSync(resolve('src/renderer/src/components/Modal.css'), 'utf8'),
  startupFailure: readFileSync(resolve('src/renderer/src/components/StartupFailureApp.css'), 'utf8'),
}

// Every block written for exactly this selector, joined.
function declarations(css: string, selector: string): string {
  return css
    .split('}')
    .filter((block) => block.split('{')[0].trim().split('\n').pop() === selector)
    .join('\n')
}

describe('dialog band lines', () => {
  it.each([
    ['modal', '.modal-header', 'border-bottom'],
    ['modal', '.modal-strip', 'border-bottom'],
    ['modal', '.modal-footer', 'border-top'],
    ['startupFailure', '.startup-failure-app h1', 'border-bottom'],
    ['startupFailure', '.startup-failure-app footer', 'border-top'],
  ] as const)('%s %s draws its %s in the control-edge colour', (sheet, selector, side) => {
    expect(declarations(sheets[sheet], selector)).toMatch(new RegExp(`${side}:\\s*1px solid var\\(--field-border\\)`))
  })
})
