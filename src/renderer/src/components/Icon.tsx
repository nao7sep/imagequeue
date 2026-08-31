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
  | 'external-link'
  | 'plus'
  | 'menu'
  | 'alert-triangle'

const PATHS: Record<IconName, React.ReactNode> = {
  'chevron-right': <polyline points="9 5 17 12 9 19" />,
  close: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>,
  check: <polyline points="4 12 10 18 20 6" />,
  // Circular arrow: retry re-runs the same task, so the loop reads as "again".
  retry: <><path d="M19.73 14.07a8 8 0 1 1-2.07-7.73" /><polyline points="20 2.5 20 9.5 13 9.5" /></>,
  // Arrow leaving a tray — export sends the image somewhere else.
  export: <><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><polyline points="8 8 12 4 16 8" /><line x1="12" y1="4" x2="12" y2="15" /></>,
  trash: <><polyline points="4 7 20 7" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /></>,
  // Archive box: "keep" takes a finished image out of the active list without
  // deleting it — filed away, not thrown away.
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><line x1="10" y1="12" x2="14" y2="12" /></>,
  restore: <><path d="M4.27 14.07a8 8 0 1 0 2.07-7.73" /><polyline points="4 2.5 4 9.5 11 9.5" /></>,
  download: <><polyline points="8 12 12 16 16 12" /><line x1="12" y1="4" x2="12" y2="16" /><path d="M4 20h16" /></>,
  upload: <><polyline points="8 8 12 4 16 8" /><line x1="12" y1="4" x2="12" y2="16" /><path d="M4 20h16" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  dots: <><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></>,
  // A window with an arrow leaving it. Its ink is fitted to the ↗ it replaces and
  // sits ON the baseline: a box hanging below one reads as broken beside capitals.
  'external-link': <><path d="M15.90 12.50L15.90 19.00L5.50 19.00L5.50 8.60L12.00 8.60" /><path d="M13.30 5.57L18.50 5.57L18.50 10.77" /><path d="M18.50 5.57L11.13 12.93" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  menu: <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>,
  'alert-triangle': <><path d="M10.3 3.6 2.4 17.2A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.8L13.7 3.6a2 2 0 0 0-3.4 0Z" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
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
      // CSS lands an inline SVG's box BOTTOM on the text baseline, not its art;
      // this puts the drawn baseline there instead. Inert inside a flex control,
      // so it only shows where an icon sits in real inline flow beside words —
      // the About links and the copy/export buttons. A sixth of an em pushed the
      // art visibly below the line; an eighth is the optical value for a 1em
      // icon set against text, and reads level with the caps.
      style={{ display: 'inline-block', verticalAlign: '-0.125em' }}
    >
      {PATHS[name]}
    </svg>
  )
}
