// Electron retains an error's message, not custom properties, across invoke.
export const STORAGE_PENDING_MARKER = 'IMAGEQUEUE_STORAGE_STILL_PENDING'
export function isStorageStillPending(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STORAGE_PENDING_MARKER)
}
