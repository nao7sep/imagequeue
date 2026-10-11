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
const exporting = new Map<string, Promise<unknown>>()
export async function ownExportDestination<T>(destination: string, operation: () => Promise<T>): Promise<T> {
  if (exporting.has(destination)) throw new Error(STORAGE_PENDING_MARKER)
  const physical = Promise.resolve().then(operation)
  exporting.set(destination, physical)
  try { return await physical }
  finally { exporting.delete(destination) }
}

/** Ordinary quit joins physical copies, including callers that timed out. */
export async function drainExports(): Promise<void> {
  const results = await Promise.allSettled(exporting.values())
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
