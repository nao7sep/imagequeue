// Persistence of the app's ephemeral UI state (~/.imagequeue/state.json) — the
// view adjustments the app remembers for the user, kept apart from config.json
// (user-authored settings) and dependencies.json (the check cache), per the
// persisted-store-separation conventions.
//
// The file is:
//   - not recorded in the data-backup store (see writeUiState) — it is volatile
//     state (column width, volume, release-check attempt), so no history is kept;
//   - materialized lazily — a missing file reads as defaults and is not written
//     until a view adjustment or release-check attempt needs recording;
//   - self-healing — a malformed file falls back to defaults rather than failing;
//   - interpreted field by field, irrespective of its format marker.

import fs from 'fs'
import { log, serializeError } from './logger'
import path from 'path'
import { writeFileAtomicAsync } from './utils/atomic-write'
import { getDataDir } from './config'
import type { UiState } from '../shared/ui-state'
import { defaultUiState } from '../shared/ui-state'
import { clampRecordsListWidth } from '../shared/records-layout'
import { FORMAT_VERSIONS } from './store-format'

export function getUiStatePath(): string {
  return path.join(getDataDir(), 'state.json')
}

// A cache: its format version is written but never checked, since each field is
// read on its own merits and overwriting a newer build's file loses only
// presentation state (store-recovery-conventions).
let writes: Promise<unknown> = Promise.resolve()

export async function readUiState(): Promise<UiState> {
  const file = getUiStatePath()
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('state.json must be a JSON object')
    const parsed = raw as Partial<UiState>
    const base = defaultUiState()
    return {
      ...(typeof parsed.releaseCheckLastAttemptUtc === 'string' ? { releaseCheckLastAttemptUtc: parsed.releaseCheckLastAttemptUtc } : {}),
      columnWidth:
        typeof parsed.columnWidth === 'number' && Number.isFinite(parsed.columnWidth)
          ? parsed.columnWidth
          : base.columnWidth,
      // Clamped, not just type-checked: this drives an <audio> volume, which
      // throws on a value outside 0–1, and the file is hand-editable.
      notificationVolume:
        typeof parsed.notificationVolume === 'number' && Number.isFinite(parsed.notificationVolume)
          ? Math.min(1, Math.max(0, parsed.notificationVolume))
          : base.notificationVolume,
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
  await fs.promises.mkdir(path.dirname(getUiStatePath()), { recursive: true })
  await writeFileAtomicAsync(getUiStatePath(), JSON.stringify({ ...state, formatVersion: FORMAT_VERSIONS.uiState }, null, 2), false)
}

export function validateUiStatePatch(value: unknown): Partial<UiState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid UI state patch.')
  const patch: Partial<UiState> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (key !== 'columnWidth' && key !== 'notificationVolume' && key !== 'recordsListWidth') {
      throw new Error('Invalid UI state patch field.')
    }
    const field = (value as Record<string, unknown>)[key]
    if (key === 'columnWidth' && field === null) {
      patch.columnWidth = null
      continue
    }
    if (typeof field !== 'number' || !Number.isFinite(field)) throw new Error('Invalid UI state patch value.')
    if (key === 'columnWidth') patch.columnWidth = field
    else if (key === 'notificationVolume') patch.notificationVolume = Math.min(1, Math.max(0, field))
    else patch.recordsListWidth = clampRecordsListWidth(field)
  }
  return patch
}

/** Apply each patch to the last successful write, so independent controls and
 * the release attempt marker cannot overwrite one another's pending changes. */
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

// Internal timestamp writes are separate from renderer-authorable UI patches.
export function recordReleaseCheckAttempt(utc: string): Promise<UiState> {
  return enqueueStatePatch({ releaseCheckLastAttemptUtc: utc })
}
