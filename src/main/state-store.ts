// Persistence of the app's ephemeral UI state (~/.imagequeue/state.json) — the
// view adjustments the app remembers for the user, kept apart from config.json
// (user-authored settings) and dependencies.json (the check cache), per the
// persisted-store-separation conventions.
//
// The file is:
//   - not recorded in the data-backup store (see writeUiState) — it is volatile
//     state and nothing else (column width, volume), so no history is kept;
//   - materialized lazily — a missing file reads as defaults and is not written
//     until the user actually changes something (a splitter drag, a volume drag);
//   - self-healing — a malformed file falls back to defaults rather than failing;
//   - never written while it is a file a newer build wrote.

import fs from 'fs'
import { log, serializeError } from './logger'
import path from 'path'
import { writeJsonAtomic } from './utils/atomic-write'
import { getDataDir } from './config'
import type { UiState } from '../shared/ui-state'
import { defaultUiState } from '../shared/ui-state'
import { clampRecordsListWidth } from '../shared/records-layout'
import { checkFormat, FORMAT_VERSIONS, NewerFormatError } from './store-format'

export function getUiStatePath(): string {
  return path.join(getDataDir(), 'state.json')
}

interface StoredUiState {
  state: UiState
  // False for a file a newer build wrote: it is read as the defaults and never
  // written (store-recovery-conventions).
  writable: boolean
}

let newerWarned = false

function readStoredUiState(): StoredUiState {
  const file = getUiStatePath()
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('state.json must be a JSON object')
    const parsed = checkFormat(raw as Record<string, unknown>, FORMAT_VERSIONS.uiState, file) as Partial<UiState>
    const base = defaultUiState()
    return {
      writable: true,
      state: {
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
      },
    }
  } catch (err) {
    if (err instanceof NewerFormatError) {
      if (!newerWarned) {
        newerWarned = true
        log('warn', 'state.json is from a newer version; using defaults and leaving it unchanged', { error: serializeError(err) })
      }
      return { state: defaultUiState(), writable: false }
    }
    // Absent is an expected probe (silent); present-but-unparseable is an
    // unexpected failure that silently resetting would leave untraceable.
    if (fs.existsSync(file)) {
      log('warn', 'Ignoring unreadable state.json; resetting to defaults', { error: serializeError(err) })
    }
    return { state: defaultUiState(), writable: true }
  }
}

export function readUiState(): UiState {
  return readStoredUiState().state
}

function writeUiState(state: UiState): void {
  fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
  // Not recorded: state.json is volatile state and nothing else (column width,
  // notification volume, the Records list width), which the data-backup conventions
  // exclude from history.
  writeJsonAtomic(getUiStatePath(), { ...state, formatVersion: FORMAT_VERSIONS.uiState }, false)
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

/** Read, apply the patch, and persist in one step. Returns the new full state. */
export function updateUiState(value: unknown): UiState {
  const patch = validateUiStatePatch(value)
  const stored = readStoredUiState()
  const next: UiState = { ...stored.state, ...patch }
  if (stored.writable) writeUiState(next)
  return next
}
