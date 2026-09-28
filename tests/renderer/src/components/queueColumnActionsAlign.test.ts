import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/renderer/src/components/QueueColumn.css'), 'utf8')
const compactCss = css.replace(/\s+/g, '')

const tsx = readFileSync(resolve('src/renderer/src/components/QueueColumn.tsx'), 'utf8')

// Pins the per-item X alignment convention (docs: xalign) for the row hover
// actions: the group (and with it the plain "close" X on task-btn-warn) sits
// on the card's first text line, .task-prompt, in EVERY state — including
// below a thumbnail, whose height is a runtime value (aspect-ratio against a
// user-resizable column). The mechanism is pure CSS: .task-prompt and
// .task-actions are real flex siblings in one row (flex: 1 / flex: none), so
// the group's rendered width is simply subtracted from the prompt's
// available width by the browser's own layout — no JS measurement, no
// ResizeObserver. jsdom has no layout engine, so this can't be asserted with
// a real box measurement; it pins the CSS/JSX wiring instead.
describe('task-actions first-line alignment', () => {
  it('puts the prompt and the action group in one flex row', () => {
    expect(compactCss).toMatch(/\.task-prompt-row\{[^}]*display:flex/)
    expect(compactCss).toMatch(/\.task-prompt-row\{[^}]*align-items:center/)
    expect(compactCss).toMatch(/\.task-prompt\{[^}]*flex:1/)
    expect(compactCss).toMatch(/\.task-prompt\{[^}]*min-width:0/)
    expect(compactCss).toMatch(/\.task-prompt\{[^}]*text-overflow:ellipsis/)
    expect(compactCss).toMatch(/\.task-actions\{[^}]*flex:none/)
  })

  it('hides the group behind opacity, not display/visibility, so its width stays reserved', () => {
    expect(compactCss).toMatch(/\.task-actions\{[^}]*opacity:0/)
    expect(compactCss).not.toMatch(/\.task-actions\{[^}]*display:none/)
  })

  it('shrinks the action group\'s margin box back to the prompt\'s line height, so it overflows the line instead of growing the row', () => {
    // The group's own box (padding + control-sm buttons) is taller than the
    // prompt's text line; without this, align-items: center on the flex row
    // would stretch the row to fit it and push .task-status down.
    expect(compactCss).toMatch(/\.task-prompt-row\{[^}]*--first-line:calc\(var\(--text-sm\)\*1\.45\)/)
    expect(compactCss).toMatch(
      /\.task-actions\{[^}]*margin-block:calc\(\(var\(--first-line\)-var\(--control-sm\)-4px\)\/2\)/
    )
  })

  it('never re-introduces JS layout measurement for this mechanism', () => {
    expect(tsx).not.toMatch(/ResizeObserver/)
    expect(tsx).not.toMatch(/actionsTop|promptPadRight/)
  })

  it('renders the prompt and the action group as real DOM siblings, not a button descendant', () => {
    // The selectable row is an invisible cover button (no nested interactive
    // controls); the prompt row lives in the sibling .task-visual.
    expect(tsx).toMatch(/className="task-visual"/)
    expect(tsx).toMatch(/className="task-prompt-row"/)
    expect(tsx).toMatch(/aria-labelledby=\{`\$\{promptId\} \$\{statusId\}`\}/)
  })
})
