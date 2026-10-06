// The three views of the selected image — the preview in the main window, the
// optional preview window, and the fullscreen view — and what passes between
// them. The main window owns the selection; the other two follow it through a
// snapshot and hand list keys back to it.

import type { Message } from './i18n/translate'
import type { Task, TaskStatus } from './types'
import type { ConfirmOptions } from './confirm'

/** The views outside the main window. */
export type ViewingSurface = 'preview-window' | 'fullscreen-view'

/** What a view needs of the selected task. */
export interface SelectedImage {
  taskId: string
  status: TaskStatus
  baseName: string | null
  error: Message | null
  providerMessage: string | null
}

/** The part of a task the views show. */
export function selectedImageOf(task: Task | null): SelectedImage | null {
  if (!task) return null
  return {
    taskId: task.id,
    status: task.status,
    baseName: task.baseName,
    error: task.error,
    providerMessage: task.providerMessage,
  }
}

/** The selection as the main process last heard it. The version is stamped by
 *  the main process and only rises, so a view drops an older snapshot that
 *  arrives after a newer one, and a reloaded main window cannot go backwards. */
export interface SelectionSnapshot {
  version: number
  task: SelectedImage | null
}

/** The snapshot a view keeps: the newer of the two. An equal version is taken
 *  again, so the main process can ask a view to report on the snapshot it has. */
export function newerSnapshot(shown: SelectionSnapshot | null, next: SelectionSnapshot): SelectionSnapshot {
  return !shown || next.version >= shown.version ? next : shown
}

/** Whether the task has an image a view can show. */
export function canShowImage(task: Pick<SelectedImage, 'status' | 'baseName'> | null | undefined): boolean {
  return !!task && (task.status === 'completed' || task.status === 'kept') && !!task.baseName
}

/** A key a view hands back to the main window's lists: arrows navigate, Space
 *  opens the fullscreen view, Backspace removes or restores, Delete deletes. */
export type ListKey = 'up' | 'down' | 'left' | 'right' | 'space' | 'remove' | 'delete'

interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  repeat: boolean
}

const ARROWS: Record<string, ListKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/** The list key a keystroke stands for, read as the lists read it
 *  (QueueColumn's key handler): only arrows repeat while held. Null for any
 *  other keystroke. */
export function listKeyFor(e: KeyLike): ListKey | null {
  const key = keyOf(e)
  return key && (!e.repeat || key in ARROW_KEYS) ? key : null
}

const ARROW_KEYS = { up: true, down: true, left: true, right: true }

function keyOf(e: KeyLike): ListKey | null {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Backspace') return 'delete'
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  if (e.key === 'Backspace') return 'remove'
  if (e.key === 'Delete') return 'delete'
  if (e.key === ' ') return 'space'
  return ARROWS[e.key] ?? null
}

/** A confirmation the main window asks a view to show. */
export interface SurfaceConfirmRequest {
  id: number
  options: ConfirmOptions
}

// The preview window's layout: the image above the failure strip, with 12px
// (--space-3) around and 8px (--space-2) between them. PreviewWindow.css
// mirrors these by value.
const PREVIEW_WINDOW_PADDING = 12
const PREVIEW_WINDOW_GAP = 8
// .preview-area's floor and .preview-failure's cap: five 11px lines at 1.4,
// 8px padding above and below, and the border.
const PREVIEW_IMAGE_MIN_HEIGHT = 120
const PREVIEW_FAILURE_MAX_HEIGHT = Math.ceil(11 * 1.4 * 5) + 8 * 2 + 2

// Derived — do not hand-edit. Wide enough for the placeholder's hint on two lines.
export const PREVIEW_WINDOW_MIN_WIDTH = 320
export const PREVIEW_WINDOW_MIN_HEIGHT =
  PREVIEW_WINDOW_PADDING * 2 + PREVIEW_IMAGE_MIN_HEIGHT + PREVIEW_WINDOW_GAP + PREVIEW_FAILURE_MAX_HEIGHT
