import type { WebContents } from 'electron'
import type { ConfirmOptions } from '../shared/confirm'
import type { SurfaceConfirmRequest, ViewingSurface } from '../shared/viewing'

// A confirmation the main window asks for on behalf of a key pressed in the
// preview window or the fullscreen view is shown there, where the user is
// looking. The view answers through answerSurfaceConfirm; a view that hides or
// closes first answers no for every dialog it still holds.
interface Pending {
  surface: ViewingSurface
  contents: WebContents
  resolve: (ok: boolean) => void
}

let nextId = 0
const pending = new Map<number, Pending>()

export const SURFACE_CONFIRM_CHANNEL = 'surface:confirm'
export const SURFACE_CONFIRM_DISMISSED_CHANNEL = 'surface:confirmDismissed'

export function askSurface(surface: ViewingSurface, contents: WebContents, options: ConfirmOptions): Promise<boolean> {
  const id = ++nextId
  return new Promise<boolean>((resolve) => {
    pending.set(id, { surface, contents, resolve })
    const request: SurfaceConfirmRequest = { id, options }
    contents.send(SURFACE_CONFIRM_CHANNEL, request)
  })
}

export function answerSurfaceConfirm(id: number, ok: boolean, sender: WebContents): void {
  const entry = pending.get(id)
  if (!entry || entry.contents !== sender) return
  pending.delete(id)
  entry.resolve(ok)
}

export function dismissSurfaceConfirms(surface: ViewingSurface): void {
  for (const [id, entry] of pending) {
    if (entry.surface !== surface) continue
    pending.delete(id)
    if (!entry.contents.isDestroyed()) entry.contents.send(SURFACE_CONFIRM_DISMISSED_CHANNEL, id)
    entry.resolve(false)
  }
}
