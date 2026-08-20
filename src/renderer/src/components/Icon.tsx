// The app's icon set. These replace typed Unicode characters used as UI chrome
// (✕ ▸ ✓ ↑ ↓ ■ ✗ …), which render as TEXT: tiny at button sizes, font-dependent,
// and different on every platform — the reason the main menu's hamburger was
// already drawn by hand rather than typed as ☰.
//
// One shape for all of them: a 24-unit square stroked in currentColor, sized in
// `em` so an icon scales with whatever text or button contains it, and marked
// aria-hidden — the accessible name belongs to the button, never the glyph.
// Stroke (not fill) keeps them legible at small sizes on the app's dark surface.

export type IconName =
  | 'chevron-right'
  | 'close'
  | 'check'
  | 'retry'
  | 'export'
  | 'trash'
  | 'archive'
  | 'restore'
  | 'download'
  | 'upload'
  | 'stop'
  | 'dots'

const PATHS: Record<IconName, React.ReactNode> = {
  'chevron-right': <polyline points="9 5 17 12 9 19" />,
  close: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>,
  check: <polyline points="4 12 10 18 20 6" />,
  // Circular arrow: retry re-runs the same task, so the loop reads as "again".
  retry: <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><polyline points="20 4 20 9 15 9" /></>,
  // Arrow leaving a tray — export sends the image somewhere else.
  export: <><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><polyline points="8 8 12 4 16 8" /><line x1="12" y1="4" x2="12" y2="15" /></>,
  trash: <><polyline points="4 7 20 7" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /></>,
  // Archive box: "keep" takes a finished image out of the active list without
  // deleting it — filed away, not thrown away.
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><line x1="10" y1="12" x2="14" y2="12" /></>,
  restore: <><path d="M4 12a8 8 0 1 0 2.34-5.66" /><polyline points="4 4 4 9 9 9" /></>,
  download: <><polyline points="8 12 12 16 16 12" /><line x1="12" y1="4" x2="12" y2="16" /><path d="M4 20h16" /></>,
  upload: <><polyline points="8 8 12 4 16 8" /><line x1="12" y1="4" x2="12" y2="16" /><path d="M4 20h16" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  dots: <><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></>,
}

export function Icon({ name, className }: { name: IconName; className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
