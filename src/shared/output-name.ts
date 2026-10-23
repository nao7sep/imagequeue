/** A session output identity is a bare file stem, never a path. */
export function isSafeOutputBaseName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    !value.includes('/') && !value.includes('\\') && !value.includes('..') && !value.includes('\0')
}
