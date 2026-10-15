import type { MessageKey } from './i18n/catalogues'

// What an ordinary quit would end while the user can still see it
// (unsaved-edits-conventions, Closing and quitting): images generating, Draw
// Things tool work, and dialogs in the main window holding unsaved edits. The
// prompt being typed is not among them: it is session-only by the developer's
// decision and is discarded without asking.

/** A main-window dialog that reports unsaved edits while it is open. */
export type DraftSurface = 'settings' | 'elaborationSettings' | 'elaborators' | 'drawThingsModels'

export const DRAFT_SURFACES: readonly DraftSurface[] = ['settings', 'elaborationSettings', 'elaborators', 'drawThingsModels']

export const DRAFT_SURFACE_NAMES: Record<DraftSurface, MessageKey> = {
  settings: 'menu.settings',
  elaborationSettings: 'elabSettings.title',
  elaborators: 'menu.elaborators',
  drawThingsModels: 'menu.drawThingsModels',
}

export interface QuitWork {
  generating: number
  tools: boolean
  drafts: DraftSurface[]
}

export function hasQuitWork(work: QuitWork): boolean {
  return work.generating > 0 || work.tools || work.drafts.length > 0
}

/** The question the quit window shows: confirm stopping live work, or a
 *  required save that failed. */
export type QuitQuestion =
  | { kind: 'confirm'; work: QuitWork; platform: string }
  | { kind: 'saveFailed' }
