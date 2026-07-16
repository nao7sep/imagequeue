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
  } catch {
    // Absent or malformed — start from defaults; the file is disposable view state.
    return defaultUiState()
  }
}

export function writeUiState(state: UiState): void {
  fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
  // not recorded: state.json is disposable view state (pane widths), re-derivable
  // to defaults on loss — not durable user-authored data (data-backup conventions).
  writeJsonAtomic(getUiStatePath(), state, false)
}

/** Read, apply the patch, and persist in one step. Returns the new full state. */
export function updateUiState(patch: Partial<UiState>): UiState {
  const next: UiState = { ...readUiState(), ...patch }
  writeUiState(next)
  return next
}
