// Persistence of the app's ephemeral UI state (~/.imagequeue/state.json) — the
// view adjustments the app remembers for the user, kept apart from config.json
// (user-authored settings) and dependencies.json (the check cache), per the
// persisted-store-separation conventions.
//
// Like the dependencies cache and unlike config.json, this file is disposable:
//   - written with writeJsonAtomic(..., recorded=false) — deliberately NOT in the
//     data-backup store, since losing it only restores default pane widths;
//   - materialized lazily — a missing file reads as defaults and is not written
//     until the user actually changes something (a splitter drag);
//   - self-healing — a malformed file falls back to defaults rather than failing.

import fs from 'fs'
import { log, serializeError } from './logger'
import path from 'path'
import { writeJsonAtomic } from './utils/atomic-write'
import { getDataDir } from './config'
import type { UiState } from '../shared/ui-state'
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
