import { describe, expect, it } from 'vitest'
import { rebaseSettingsDraft } from '../../../../src/renderer/src/utils/settingsDraft'

describe('rebaseSettingsDraft', () => {
  it('takes each stored change the user has not edited and keeps each edit', () => {
    const base = { general: { show_preview_window: true, theme: 'system', idle: 30 }, list: ['a'] }
    const draft = { general: { show_preview_window: true, theme: 'dark', idle: 30 }, list: ['a', 'b'] }
    const stored = { general: { show_preview_window: false, theme: 'light', idle: 30 }, list: ['c'] }
    expect(rebaseSettingsDraft(base, draft, stored)).toEqual({
      general: { show_preview_window: false, theme: 'dark', idle: 30 },
      list: ['a', 'b'],
    })
  })

  it('adds a value that is newly stored and drops one no longer stored that the user did not set', () => {
    const base = { general: { old: 1 } }
    const draft = { general: { old: 1, typed: 'x' } }
    const stored = { general: { added: true } }
    expect(rebaseSettingsDraft(base, draft, stored)).toEqual({ general: { added: true, typed: 'x' } })
  })
})
