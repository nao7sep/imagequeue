export function shouldDeleteToTrash(value: unknown): boolean {
  return value !== false
}

export function shouldDropEmptySessions(value: unknown): boolean {
  return value !== false
}
