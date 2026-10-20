// The completion toast's success and failure marks: the app icon set's check
// and close shapes, as SVG markup, because the toast's own window draws plain
// HTML and cannot use the React icon component. A test checks them against
// that component's shapes.
export const TOAST_MARKS = {
  check: '<polyline points="4 12 10 18 20 6"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
} as const
