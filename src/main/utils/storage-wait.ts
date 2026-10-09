import { STORAGE_PENDING_MARKER } from '../../shared/storage-wait'

/** Bounds only the caller; the original owner keeps its physical operation. */
export async function waitForStorage<T>(operation: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(STORAGE_PENDING_MARKER)), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

// A timed-out Save As must not release its destination to a second copy which
// the older copy could later replace. Different destinations remain independent.
const exporting = new Set<string>()
export async function ownExportDestination<T>(destination: string, operation: () => Promise<T>): Promise<T> {
  if (exporting.has(destination)) throw new Error(STORAGE_PENDING_MARKER)
  exporting.add(destination)
  try { return await operation() }
  finally { exporting.delete(destination) }
}
