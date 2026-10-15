import type { WebContents } from 'electron'
import { handle } from './ipc-boundary'
import { DRAFT_SURFACES, type DraftSurface } from '../shared/quit'

// Main-window dialogs report whether they hold unsaved edits, so a close or
// quit can ask once before discarding them (unsaved-edits-conventions). Only
// the main window's page reports; a page that goes away takes its reports
// with it.
const dirty = new Set<DraftSurface>()
let reporter: WebContents | null = null

export function unsavedDrafts(): DraftSurface[] {
  return DRAFT_SURFACES.filter((surface) => dirty.has(surface))
}

export function registerUnsavedDraftsIpc(getMainContents: () => WebContents | null): void {
  handle('drafts:report', (event, surface: unknown, isDirty: unknown) => {
    const main = getMainContents()
    if (!main || event.sender !== main || !(DRAFT_SURFACES as readonly unknown[]).includes(surface)) return
    if (reporter !== main) {
      dirty.clear()
      reporter = main
      const forget = (): void => { if (reporter === main) { dirty.clear(); reporter = null } }
      main.once('destroyed', forget)
      main.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) forget() })
    }
    if (isDirty === true) dirty.add(surface as DraftSurface)
    else dirty.delete(surface as DraftSurface)
  })
}
