import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const modalCss = readFileSync(
  new URL('../../../../src/renderer/src/components/Modal.css', import.meta.url),
  'utf8',
)
const startupCss = readFileSync(
  new URL('../../../../src/renderer/src/components/StartupFailureApp.css', import.meta.url),
  'utf8',
)

describe('modal presentation contracts', () => {
  it('reveals quiet header-close chrome for both pointer and keyboard focus', () => {
    expect(modalCss).toMatch(/\.modal-close:hover,\s*\.modal-close:focus-visible\s*\{[^}]*background:/s)
    expect(modalCss).toMatch(/\.modal-close:focus-visible\s*\{[^}]*outline:/s)
  })

  it('keeps modal and startup message bodies scrollable between fixed bands', () => {
    expect(modalCss).toMatch(/\.confirm-body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s)
    expect(startupCss).toMatch(/\.startup-failure-app p\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s)
    expect(startupCss).toMatch(/\[data-measuring='true'\]\s*\{[^}]*height:\s*auto;/s)
    expect(startupCss).toMatch(/\[data-measuring='true'\] p\s*\{[^}]*flex:\s*none;[^}]*overflow:\s*visible;/s)
  })
})
