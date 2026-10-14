// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

// On macOS, Ctrl inside a text field belongs to the text system, so the Ctrl
// half of a dual-bound chord stands down there; elsewhere Ctrl is the
// modifier and must keep firing. The platform is read once at import, so each
// case loads the module afresh under the platform it is testing.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function shortcutsOn(platform: string): Promise<typeof import('../../../../src/renderer/src/utils/shortcuts')> {
  vi.resetModules()
  vi.stubGlobal('navigator', { platform, userAgent: '' })
  return import('../../../../src/renderer/src/utils/shortcuts')
}

const ctrlChord = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true })
const cmdChord = new KeyboardEvent('keydown', { key: 'p', metaKey: true })
const ctrlCmdChord = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, metaKey: true })

describe('Mac text-field stand-down', () => {
  it.each(['MacIntel', 'MacARM', 'iPhone'])('stands down for Ctrl alone on %s', async (platform) => {
    const { shadowsMacTextBinding } = await shortcutsOn(platform)
    expect(shadowsMacTextBinding(ctrlChord)).toBe(true)
  })

  it('still lets the Cmd chord, alone or with Ctrl, fire on macOS', async () => {
    const { shadowsMacTextBinding } = await shortcutsOn('MacIntel')
    expect(shadowsMacTextBinding(cmdChord)).toBe(false)
    expect(shadowsMacTextBinding(ctrlCmdChord)).toBe(false)
  })

  it.each(['Win32', 'Linux x86_64'])('never stands down on %s, where Ctrl is the modifier', async (platform) => {
    const { shadowsMacTextBinding } = await shortcutsOn(platform)
    expect(shadowsMacTextBinding(ctrlChord)).toBe(false)
    expect(shadowsMacTextBinding(cmdChord)).toBe(false)
  })

  it('falls back to the user agent when the platform is blank', async () => {
    vi.resetModules()
    vi.stubGlobal('navigator', { platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' })
    const { shadowsMacTextBinding } = await import('../../../../src/renderer/src/utils/shortcuts')
    expect(shadowsMacTextBinding(ctrlChord)).toBe(true)
  })
})
