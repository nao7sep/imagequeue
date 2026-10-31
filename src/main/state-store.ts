// Persistence of the app's ephemeral UI state (~/.imagequeue/state.json) — the
// view adjustments the app remembers for the user, kept apart from config.json
// (user-authored settings) and dependencies.json (the check cache), per the
// persisted-store-separation conventions.
//
// The file is:
//   - not recorded in the data-backup store (see writeUiState) — it is volatile
//     state (column and splitter widths), so no history is kept;
//   - materialized lazily — a missing file reads as defaults and is not written
//     until a view adjustment needs recording;
//   - self-healing — a malformed file falls back to defaults rather than failing;
//   - interpreted field by field, irrespective of its file header.

import fs from 'fs'
import { log, serializeError } from './logger'
import path from 'path'
import { writeFileAtomicAsync } from './utils/atomic-write'
import { getDataDir } from './config'
import type { UiState } from '../shared/ui-state'
import { defaultUiState } from '../shared/ui-state'
import { clampRecordsListWidth } from '../shared/records-layout'
import { cacheWritable, FILE_FORMATS, parseHeaderedJson, withHeader } from './store-format'

export function getUiStatePath(): string {
  return path.join(getDataDir(), 'state.json')
}

// Presentation state: its header is checked, so a newer file stops the launch
// and is never written over, while an unreadable one reads as the defaults and
// the next save replaces it (store-recovery-conventions).
let writes: Promise<unknown> = Promise.resolve()

export async function readUiState(): Promise<UiState> {
  const file = getUiStatePath()
  try {
    const raw: unknown = parseHeaderedJson(await fs.promises.readFile(file, 'utf8'), FILE_FORMATS.uiState, file)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('state.json must be a JSON object')
    const parsed = raw as Partial<UiState>
    const base = defaultUiState()
    return {
      columnWidth:
        typeof parsed.columnWidth === 'number' && Number.isFinite(parsed.columnWidth)
          ? parsed.columnWidth
          : base.columnWidth,
      recordsListWidth: clampRecordsListWidth(parsed.recordsListWidth),
    }
  } catch (err) {
    // Absent is an expected probe (silent); present-but-unparseable is an
    // unexpected failure that silently resetting would leave untraceable.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log('warn', 'Ignoring unreadable state.json; resetting to defaults', { error: serializeError(err) })
    }
    return defaultUiState()
  }
}

async function writeUiState(state: UiState): Promise<void> {
  // A newer version's cache stays as it is (store-recovery-conventions, A
  // refused file is never changed); an unreadable one may be replaced.
  if (!await cacheWritable(getUiStatePath(), FILE_FORMATS.uiState)) return
  await fs.promises.mkdir(path.dirname(getUiStatePath()), { recursive: true })
  await writeFileAtomicAsync(getUiStatePath(), JSON.stringify(withHeader(state, FILE_FORMATS.uiState), null, 2), false)
}

export function validateUiStatePatch(value: unknown): Partial<UiState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid UI state patch.')
  const patch: Partial<UiState> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (key !== 'columnWidth' && key !== 'recordsListWidth') {
      throw new Error('Invalid UI state patch field.')
    }
    const field = (value as Record<string, unknown>)[key]
    if (key === 'columnWidth' && field === null) {
      patch.columnWidth = null
      continue
    }
    if (typeof field !== 'number' || !Number.isFinite(field)) throw new Error('Invalid UI state patch value.')
    if (key === 'columnWidth') patch.columnWidth = field
    else patch.recordsListWidth = clampRecordsListWidth(field)
  }
  return patch
}

/** Apply each patch to the last successful write, so independent controls
 * cannot overwrite one another's pending changes. */
function enqueueStatePatch(patch: Partial<UiState>): Promise<UiState> {
  const operation = writes.then(async () => {
    const next = { ...await readUiState(), ...patch }
    await writeUiState(next)
    return { ...next }
  })
  writes = operation.catch(() => undefined)
  return operation
}

export function updateUiState(value: unknown): Promise<UiState> {
  return enqueueStatePatch(validateUiStatePatch(value))
}

