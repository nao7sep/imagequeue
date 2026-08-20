// Whitespace cleanup and truncation for stored and displayed text, per the
// fleet text-cleanup-conventions. Three patterns, no more: single-line for
// scalar fields, multiline for bodies whose line structure matters, and
// multiline-truncation for one-line previews of possibly-multiline text.
//
// These run at COMMIT or DISPLAY time only — never on a keystroke or mid-IME
// composition (that is owned by the text-input-ime-conventions). "Whitespace"
// and "blank" lean on the language's own notions (`\s`, `String.trim`), which
// already cover the full-width space U+3000 and NBSP, so there is no
// hand-maintained character table. Zero-width characters (ZWSP/ZWNJ/ZWJ) are
// deliberately left alone — ZWJ is structural inside emoji.

// ---- single-line ----
// For scalar values — names, labels, single fields. Always trims the ends;
// `flattenLineBreaks` (default true) collapses any whitespace run containing a
// line break into one ASCII space (so a pasted-across-lines value becomes one
// line) while preserving pure horizontal spacing; `minify` (default false)
// collapses every run of 1+ whitespace — including a lone U+3000 — into one
// space, and so dominates flattenLineBreaks. This normalizes; it does not
// validate. Use validation, not this, for identity/strict-format fields.
export function singleLine(
  text: string,
  opts: { flattenLineBreaks?: boolean; minify?: boolean } = {}
): string {
  const { flattenLineBreaks = true, minify = false } = opts
  if (minify) return text.replace(/\s+/g, ' ').trim()
  if (flattenLineBreaks) return text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  return text.trim()
}

// ---- multiline ----
// For bodies where line structure matters — prompts, templates, descriptions.
// Indentation is always preserved. `trimLineEnds` (default true) drops trailing
// whitespace per line (switch off for Markdown's two-trailing-space hard
// break); `dropEdgeBlankLines` (default true) drops blank lines before the
// first and after the last visible line; `collapseBlankLines` (default false,
// since an interior blank run is often a deliberate section break) reduces
// interior runs of blank lines to one. A line is blank when its trimmed form is
// empty, so a line of spaces or a lone U+3000 counts as blank.
export function multiline(
  text: string,
  opts: { trimLineEnds?: boolean; dropEdgeBlankLines?: boolean; collapseBlankLines?: boolean } = {}
): string {
  const { trimLineEnds = true, dropEdgeBlankLines = true, collapseBlankLines = false } = opts
  const isBlank = (l: string): boolean => l.trim() === ''
  let lines = text.split(/\r\n|\r|\n/)
  if (trimLineEnds) lines = lines.map((l) => l.replace(/\s+$/, ''))

  let start = 0
  let end = lines.length
  if (dropEdgeBlankLines) {
    while (start < end && isBlank(lines[start])) start++
    while (end > start && isBlank(lines[end - 1])) end--
  }

  const out: string[] = []
  let prevBlank = false
  for (const line of lines.slice(start, end)) {
    const blank = isBlank(line)
    if (collapseBlankLines && blank && prevBlank) continue
    out.push(line)
    prevBlank = blank
  }
  return out.join('\n')
}

// ---- multiline-truncation ----
// For previews and snippets — the first part of a possibly-multiline body,
// rendered on one line. Whitespace runs (including newlines) become one ASCII
// space; leading/trailing whitespace is dropped. `n` is a MINIMUM length in
// graphemes, not exact: callers pass an `n` well above what the pane shows and
// let CSS do the visual fitting. Reads by grapheme so emoji and combining
// sequences never split. `truncated` is true only when a visible grapheme
// exists past the cut point, so an all-whitespace tail never reports a cut.
// No ellipsis: a caller that renders `text` whole appends its own marker.
export interface TruncateResult {
  text: string
  truncated: boolean
}

export function truncate(text: string, n: number): TruncateResult {
  if (n <= 0) return { text: '', truncated: false }
  const out: string[] = []
  let pendingSpace = false
  let budgetMet = false
  let truncated = false

  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const isWhitespace = segment.trim() === ''
    if (!budgetMet) {
      if (isWhitespace) {
        if (out.length > 0) pendingSpace = true // skip leading, hold trailing
        continue
      }
      if (pendingSpace) {
        out.push(' ')
        pendingSpace = false
      }
      out.push(segment)
      if (out.length >= n) budgetMet = true
    } else if (!isWhitespace) {
      truncated = true // a visible grapheme exists past the cut point
      break
    }
  }
  return { text: out.join(''), truncated }
}

// Min-length budget for the app's one-line prompt previews (task tile, the
// collapsed metadata toggle, the elaborated-prompts rows). Well above what any
// of those panes show — CSS still does the visual clamp; this only bounds how
// much text we flatten and carry, with the full text kept in title/tooltip.
export const PROMPT_PREVIEW_MIN_GRAPHEMES = 200
