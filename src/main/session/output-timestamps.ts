import { BACKEND_IDS_IN_UI_ORDER, BackendId, Task } from '../../shared/types'
import { TimestampAllocator } from './timestamp-allocator'

const allocators: Record<BackendId, TimestampAllocator> = {
  openai: new TimestampAllocator(),
  imagen: new TimestampAllocator(),
  nanobanana: new TimestampAllocator(),
  grok: new TimestampAllocator(),
  flux: new TimestampAllocator(),
  drawthings: new TimestampAllocator(),
}

const BASENAME_TIMESTAMP_RE = /^(\d{8})-(\d{6})-utc(?:-|$)/

export function allocateOutputTimestamp(backend: BackendId): Promise<string> {
  return allocators[backend].allocate()
}

export function resetOutputTimestampAllocators(): void {
  for (const allocator of Object.values(allocators)) {
    allocator.reset()
  }
}

export function seedOutputTimestampAllocators(tasksByBackend: Record<BackendId, Task[]>): void {
  for (const backend of BACKEND_IDS_IN_UI_ORDER) {
    for (const task of tasksByBackend[backend] ?? []) {
      const timestampMs = parseTimestampMs(task.baseName)
      if (timestampMs !== null) {
        allocators[backend].seed(timestampMs)
      }
    }
  }
}

function parseTimestampMs(baseName: string | null): number | null {
  if (!baseName) return null
  const match = BASENAME_TIMESTAMP_RE.exec(baseName)
  if (!match) return null

  const datePart = match[1]
  const timePart = match[2]
  const year = Number(datePart.slice(0, 4))
  const month = Number(datePart.slice(4, 6))
  const day = Number(datePart.slice(6, 8))
  const hour = Number(timePart.slice(0, 2))
  const minute = Number(timePart.slice(2, 4))
  const second = Number(timePart.slice(4, 6))

  if ([year, month, day, hour, minute, second].some((value) => Number.isNaN(value))) {
    return null
  }

  return Date.UTC(year, month - 1, day, hour, minute, second)
}
