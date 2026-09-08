// Persistence of the app's ephemeral UI state (~/.imagequeue/state.json) — the
// view adjustments the app remembers for the user, kept apart from config.json
// (user-authored settings) and dependencies.json (the check cache), per the
// persisted-store-separation conventions.
//
// The file is:
//   - recorded in the data-backup store (see writeUiState) — small, frequently
//     rewritten JSON is exactly what a dedupe-by-content history absorbs;
//   - materialized lazily — a missing file reads as defaults and is not written
//     until the user actually changes something (a splitter drag, a volume drag);
//   - self-healing — a malformed file falls back to defaults rather than failing.

import fs from 'fs'
import { log, serializeError } from './logger'
import path from 'path'
import { writeJsonAtomic } from './utils/atomic-write'
import { getDataDir } from './config'
import type { UiState, WindowBounds, WindowPlacementRecord } from '../shared/ui-state'
import { defaultUiState } from '../shared/ui-state'

export function getUiStatePath(): string {
  return path.join(getDataDir(), 'state.json')
}

export function readUiState(): UiState {
  try {
    const raw = fs.readFileSync(getUiStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UiState>
    const base = defaultUiState()
    return {
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
      windowPlacements: normalizeWindowPlacements(parsed.windowPlacements, base.windowPlacements),
    }
  } catch (err) {
    // Absent is an expected probe (silent); present-but-unparseable is an
    // unexpected failure that silently resetting would leave untraceable.
    if (fs.existsSync(getUiStatePath())) {
      log('warn', 'Ignoring unreadable state.json; resetting to defaults', { error: serializeError(err) })
    }
    return defaultUiState()
  }
}

function normalizeWindowPlacements(
  raw: unknown,
  fallback: UiState['windowPlacements'],
): UiState['windowPlacements'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { main: cloneWindowPlacement(fallback.main) }
  }
  const source = raw as Record<string, unknown>
  if (source.main === undefined) return { main: cloneWindowPlacement(fallback.main) }
  if (source.main === null) return { main: null }
  if (!source.main || typeof source.main !== 'object' || Array.isArray(source.main)) {
    return { main: cloneWindowPlacement(fallback.main) }
  }
  const placement = source.main as Record<string, unknown>
  return {
    main: {
      normalBounds: normalizeWindowBounds(placement.normalBounds, fallback.main?.normalBounds ?? null),
      mode:
        placement.mode === 'normal' || placement.mode === 'maximized'
          ? placement.mode
          : fallback.main?.mode ?? 'maximized',
    },
  }
}

function normalizeWindowBounds(raw: unknown, fallback: WindowBounds | null): WindowBounds | null {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback ? { ...fallback } : null
  const source = raw as Record<string, unknown>
  const values = [source.x, source.y, source.width, source.height]
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return fallback ? { ...fallback } : null
  }
  return {
    x: source.x as number,
    y: source.y as number,
    width: source.width as number,
    height: source.height as number,
  }
}

function cloneWindowPlacement(value: WindowPlacementRecord | null): WindowPlacementRecord | null {
  return value
    ? { normalBounds: value.normalBounds ? { ...value.normalBounds } : null, mode: value.mode }
    : null
}

export function writeUiState(state: UiState): void {
  fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
  // Recorded: the data-backup conventions name state.json explicitly among the
  // recorded stores — small frequently-rewritten JSON is exactly what the
  // dedupe-by-content history absorbs for free, and state files are where
  // durable registries tend to accumulate later.
  writeJsonAtomic(getUiStatePath(), state, true)
}

/** Read, apply the patch, and persist in one step. Returns the new full state. */
export function updateUiState(patch: Partial<UiState>): UiState {
  const next: UiState = { ...readUiState(), ...patch }
  writeUiState(next)
  return next
}
