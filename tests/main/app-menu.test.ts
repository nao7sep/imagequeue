import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildAppMenuTemplate, buildTextContextMenuTemplate } from '../../src/main/app-menu'
import { createTranslator } from '../../src/shared/i18n/translate'

// The application menu is Electron's default menu with every label in the
// interface language. Items keep their roles, so the system's standard actions
// still reach whatever has focus and macOS still adds its own Edit items.

function submenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  return item.submenu as MenuItemConstructorOptions[]
}

function titles(template: MenuItemConstructorOptions[]): Array<string | undefined> {
  return template.map((item) => item.label)
}

describe('application menu', () => {
  it('titles every menu in the interface language, the Edit menu included', () => {
    const ja = createTranslator('ja')
    const template = buildAppMenuTemplate(ja, 'darwin')
    expect(titles(template)).toEqual([
      'ImageQueue',
      ja.t('nativeMenu.file'),
      ja.t('nativeMenu.edit'),
      ja.t('nativeMenu.view'),
      ja.t('nativeMenu.window'),
      ja.t('nativeMenu.help'),
    ])
    expect(ja.t('nativeMenu.edit')).not.toBe('Edit')
  })

  it('keeps each item on its role, with a label in the language', () => {
    const de = createTranslator('de')
    const template = buildAppMenuTemplate(de, 'darwin')
    const edit = submenu(template[2]!)
    expect(edit.filter((item) => item.role).map((item) => item.role)).toEqual([
      'undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll',
    ])
    for (const item of template.flatMap((menu) => submenu(menu) ?? [])) {
      if (item.type === 'separator') continue
      expect(item.label, String(item.role)).toBeTruthy()
    }
    expect(template[4]!.role).toBe('windowMenu')
    expect(submenu(template[0]!).find((item) => item.role === 'about')?.label).toBe(de.t('nativeMenu.about', { app: 'ImageQueue' }))
  })

  it('carries Exit in File and no app menu on Windows', () => {
    const en = createTranslator('en')
    const template = buildAppMenuTemplate(en, 'win32')
    expect(titles(template)).toEqual(['File', 'Edit', 'View', 'Window', 'Help'])
    expect(submenu(template[0]!)).toEqual([{ role: 'quit', label: 'Exit' }])
  })
})

describe('text context menu', () => {
  const flags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

  it('offers nothing outside editable text and selections', () => {
    expect(buildTextContextMenuTemplate(createTranslator('en'), {
      isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [], editFlags: flags,
    }, () => {})).toBeNull()
  })

  it('words the edit actions in the interface language and says when no spelling suggestion exists', () => {
    const fr = createTranslator('fr')
    const template = buildTextContextMenuTemplate(fr, {
      isEditable: true, selectionText: 'x', misspelledWord: 'teh', dictionarySuggestions: [], editFlags: flags,
    }, () => {})!
    expect(template[0]).toEqual({ label: fr.t('nativeMenu.noSuggestions'), enabled: false })
    expect(template.find((item) => item.role === 'paste')?.label).toBe(fr.t('nativeMenu.paste'))
  })
})
