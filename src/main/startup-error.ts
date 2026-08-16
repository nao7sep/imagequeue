/** Truthful guidance shared by every synchronous main-process startup failure. */
export function startupFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return (
    detail +
    '\n\nImageQueue stopped before opening its window. Correct the reported problem, then start it again.'
  )
}
