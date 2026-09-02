import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../src/main/startup-failure-window.ts', import.meta.url),
  'utf8',
)

describe('startup failure window sizing owner', () => {
  it('waits for the committed renderer measurement instead of measuring at dom-ready', () => {
    expect(source).toContain('STARTUP_FAILURE_MEASUREMENT_CHANNEL')
    expect(source).toContain('ipcMain.on(STARTUP_FAILURE_MEASUREMENT_CHANNEL, receiveMeasurement)')
    expect(source).not.toContain("once('dom-ready'")
    expect(source).not.toContain('executeJavaScript')
  })

  it('applies the fitted content height before showing the isolated window', () => {
    expect(source.indexOf('win.setContentSize(520, fit.height)'))
      .toBeLessThan(source.indexOf('win.show()'))
  })
})
