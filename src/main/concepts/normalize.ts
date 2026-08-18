// Identity normalization for the concept store. A value's key decides whether
// two texts are the same concept: Unicode compatibility forms fold (a
// full-width comma reads as its ASCII form), case folds, whitespace runs
// collapse, and trailing punctuation drops. Deliberately nothing semantic —
// "sailor" and "mariner" are different keys, and keeping them apart is the
// planner's job (narrow, non-overlapping asks), never a similarity score.
export function normalizeKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\s\p{P}]+$/u, '')
}

// Display cleanup: what normalization does to identity, minus the case fold and
// punctuation strip — the stored display is shown to the user and woven into
// prompts, so it keeps its casing.
export function cleanDisplay(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
