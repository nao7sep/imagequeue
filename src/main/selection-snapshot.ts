import type { SelectedImage, SelectionSnapshot } from '../shared/viewing'

// The selection as the main window last published it, for the preview window
// and the fullscreen view. The version is stamped here rather than by the
// renderer, so it keeps rising across a reload of the main window.
export const SELECTION_SNAPSHOT_CHANNEL = 'selection:snapshot'

let latest: SelectionSnapshot = { version: 0, task: null }
const listeners = new Set<(snapshot: SelectionSnapshot) => void>()

export function publishSelection(task: SelectedImage | null): SelectionSnapshot {
  latest = { version: latest.version + 1, task }
  for (const listener of listeners) listener(latest)
  return latest
}

export function latestSelection(): SelectionSnapshot {
  return latest
}

export function onSelectionPublished(listener: (snapshot: SelectionSnapshot) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
