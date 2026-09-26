import type { MenuItemConstructorOptions } from 'electron'
import type { Translator } from '../shared/i18n/translate'

const APP_NAME = 'ImageQueue'

/**
 * The application menu: Electron's default menu, item for item, with every
 * label taken from the interface language. Each item keeps its role, so Edit
 * and Window send the system's standard actions to whatever has focus, and
 * macOS still adds its own Edit items (Emoji & Symbols, Start Dictation) and
 * the list of open windows whatever the menus are titled.
 */
export function buildAppMenuTemplate(t: Translator, platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'
  const l = t.t
  return [
    ...(mac
      ? [{
          label: APP_NAME,
          submenu: [
            { role: 'about', label: l('nativeMenu.about', { app: APP_NAME }) },
            { type: 'separator' },
            { role: 'services', label: l('nativeMenu.services') },
            { type: 'separator' },
            { role: 'hide', label: l('nativeMenu.hide', { app: APP_NAME }) },
            { role: 'hideOthers', label: l('nativeMenu.hideOthers') },
            { role: 'unhide', label: l('nativeMenu.showAll') },
            { type: 'separator' },
            { role: 'quit', label: l('nativeMenu.quit', { app: APP_NAME }) },
          ],
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: l('nativeMenu.file'),
      submenu: [
        mac
          ? { role: 'close', label: l('nativeMenu.closeWindow') }
          : { role: 'quit', label: l('nativeMenu.exit') },
      ],
    },
    {
      label: l('nativeMenu.edit'),
      submenu: [
        { role: 'undo', label: l('nativeMenu.undo') },
        { role: 'redo', label: l('nativeMenu.redo') },
        { type: 'separator' },
        { role: 'cut', label: l('nativeMenu.cut') },
        { role: 'copy', label: l('nativeMenu.copy') },
        { role: 'paste', label: l('nativeMenu.paste') },
        ...(mac
          ? [
              { role: 'pasteAndMatchStyle', label: l('nativeMenu.pasteAndMatchStyle') },
              { role: 'delete', label: l('nativeMenu.delete') },
              { role: 'selectAll', label: l('nativeMenu.selectAll') },
              { type: 'separator' },
              {
                label: l('nativeMenu.speech'),
                submenu: [
                  { role: 'startSpeaking', label: l('nativeMenu.startSpeaking') },
                  { role: 'stopSpeaking', label: l('nativeMenu.stopSpeaking') },
                ],
              },
            ] satisfies MenuItemConstructorOptions[]
          : [
              { role: 'delete', label: l('nativeMenu.delete') },
              { type: 'separator' },
              { role: 'selectAll', label: l('nativeMenu.selectAll') },
            ] satisfies MenuItemConstructorOptions[]),
      ],
    },
    {
      label: l('nativeMenu.view'),
      submenu: [
        { role: 'reload', label: l('nativeMenu.reload') },
        { role: 'forceReload', label: l('nativeMenu.forceReload') },
        { role: 'toggleDevTools', label: l('nativeMenu.toggleDevTools') },
        { type: 'separator' },
        { role: 'resetZoom', label: l('nativeMenu.actualSize') },
        { role: 'zoomIn', label: l('nativeMenu.zoomIn') },
        { role: 'zoomOut', label: l('nativeMenu.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: l('nativeMenu.fullscreen') },
      ],
    },
    {
      role: 'windowMenu',
      label: l('nativeMenu.window'),
      submenu: [
        { role: 'minimize', label: l('nativeMenu.minimize') },
        { role: 'zoom', label: l('nativeMenu.zoom') },
        ...(mac
          ? [
              { type: 'separator' },
              { role: 'front', label: l('nativeMenu.bringAllToFront') },
            ] satisfies MenuItemConstructorOptions[]
          : [{ role: 'close', label: l('nativeMenu.close') }] satisfies MenuItemConstructorOptions[]),
      ],
    },
    { role: 'help', label: l('nativeMenu.help'), submenu: [] },
  ]
}

export interface EditContext {
  isEditable: boolean
  selectionText: string
  misspelledWord: string
  dictionarySuggestions: string[]
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

/**
 * The text context menu: spelling suggestions, then the edit actions the
 * focused field can take. Returns null where there is nothing to offer.
 */
export function buildTextContextMenuTemplate(
  t: Translator,
  params: EditContext,
  replaceMisspelling: (word: string) => void,
): MenuItemConstructorOptions[] | null {
  const { isEditable, selectionText, editFlags, misspelledWord, dictionarySuggestions } = params
  const hasSelection = selectionText.length > 0
  if (!isEditable && !hasSelection) return null
  const l = t.t
  const template: MenuItemConstructorOptions[] = []

  if (misspelledWord) {
    if (dictionarySuggestions.length > 0) {
      for (const word of dictionarySuggestions) {
        template.push({ label: word, click: () => replaceMisspelling(word) })
      }
    } else {
      template.push({ label: l('nativeMenu.noSuggestions'), enabled: false })
    }
    template.push({ type: 'separator' })
  }

  if (isEditable) {
    if (editFlags.canUndo || editFlags.canRedo) {
      template.push(
        { label: l('nativeMenu.undo'), role: 'undo', enabled: editFlags.canUndo },
        { label: l('nativeMenu.redo'), role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
      )
    }
    template.push(
      { label: l('nativeMenu.cut'), role: 'cut', enabled: editFlags.canCut },
      { label: l('nativeMenu.copy'), role: 'copy', enabled: editFlags.canCopy },
      { label: l('nativeMenu.paste'), role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { label: l('nativeMenu.selectAll'), role: 'selectAll', enabled: editFlags.canSelectAll },
    )
  } else {
    template.push({ label: l('nativeMenu.copy'), role: 'copy' })
  }
  return template
}
