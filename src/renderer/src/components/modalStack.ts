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

export function pushModal(id: string): void {
  stack.push(id)
}

export function popModal(id: string): void {
  const index = stack.lastIndexOf(id)
  if (index >= 0) stack.splice(index, 1)
}

export function isTopmostModal(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

export function isAnyModalOpen(): boolean {
  return stack.length > 0
}
