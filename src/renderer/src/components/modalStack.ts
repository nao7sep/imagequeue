// Shared registry of open app modals, topmost last. The Modal shell pushes on
// mount and pops on unmount; everything else reads it.
//
// It drives three things:
//   - "topmost only" Escape / backdrop / Tab-trap routing inside Modal.tsx
//   - the global `isAnyModalOpen()` guard that underlying-window key handlers
//     (PromptPane, Layout, SelectionContext) use to suppress their shortcuts
//     while a modal is open
//
// Background scroll does NOT need to be locked here: the app shell is fixed
// (`html, body, #root { overflow: hidden }` in styles.css) and the backdrop is
// portaled to <body>, so its only scroll-chain ancestors are body/html — there
// is nothing behind the backdrop that wheel events can scroll.
//
// Pure array logic, no DOM, so it is unit-testable without jsdom.

const stack: string[] = []
const listeners = new Set<(open: boolean) => void>()

function notify(wasOpen: boolean): void {
  if (wasOpen === isAnyModalOpen()) return
  for (const listener of listeners) listener(isAnyModalOpen())
}

export function pushModal(id: string): void {
  const wasOpen = isAnyModalOpen()
  stack.push(id)
  notify(wasOpen)
}

export function popModal(id: string): void {
  const wasOpen = isAnyModalOpen()
  const index = stack.lastIndexOf(id)
  if (index >= 0) stack.splice(index, 1)
  notify(wasOpen)
}

/** Follows whether any modal is open, for the native menu's About and Settings. */
export function onModalOpenChange(listener: (open: boolean) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isTopmostModal(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

export function isAnyModalOpen(): boolean {
  return stack.length > 0
}
