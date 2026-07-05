// Storage layout for the app-owned managed dependencies, all under the storage
// root (so they honor IMAGEQUEUE_HOME):
//
//   bin/draw-things-cli        the persisted CLI binary
//   bin/draw-things-cli.json   sidecar: the release tag + hash recorded at install
//   temp/<stem>-<nanoid>.tmp   deletable staging for in-flight downloads
//   dependencies.json          ephemeral check cache (last-known-latest, timestamps)
//
// configs.json (the recommendations file) lives in the effective models dir
// alongside Draw Things' own custom.json — see recommendations.ts. bin/ is the one
// kept artifact here; temp/ and dependencies.json are safe to delete (the app
// rebuilds them on the next check/install).

import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { getDataDir } from '../config'

export function getBinDir(): string {
  return path.join(getDataDir(), 'bin')
}

export function getTempDir(): string {
  return path.join(getDataDir(), 'temp')
}

export function getCliBinaryPath(): string {
  return path.join(getBinDir(), 'draw-things-cli')
}

export function getCliMetaPath(): string {
  return path.join(getBinDir(), 'draw-things-cli.json')
}

export function getDependenciesStatePath(): string {
  return path.join(getDataDir(), 'dependencies.json')
}

/** Allocate a fresh staging path under temp/, creating the directory. The name is
 * `<stem>-<nanoid>.tmp`, where stem is destPath's filename minus its extension
 * (e.g. installing to bin/draw-things-cli stages at temp/draw-things-cli-<nanoid>.tmp)
 * — the filename-conventions' derived-filename grammar, never a bare nanoid. The
 * caller verifies the download there and atomically renames it into its kept
 * home (destPath), or deletes it on failure — nothing under temp/ is ever
 * loaded directly. */
export function allocateTempPath(destPath: string): string {
  const dir = getTempDir()
  fs.mkdirSync(dir, { recursive: true })
  const stem = path.basename(destPath, path.extname(destPath))
  return path.join(dir, `${stem}-${nanoid()}.tmp`)
}

/** Best-effort removal of a staging file. Used on the failure path, where the
 * original error is what matters — a cleanup failure must not mask it. */
export function discardTempPath(tempPath: string): void {
  try {
    fs.rmSync(tempPath, { force: true })
  } catch {
    /* ignore — staging lives under the deletable temp/ dir */
  }
}

/** Clear the staging directory. Run once at startup to remove any orphan left by
 * an interrupted download (a crash mid-stream) — nothing under temp/ is ever
 * loaded, so this is always safe and never runs concurrently with a live stage. */
export function clearTempDir(): void {
  try {
    fs.rmSync(getTempDir(), { recursive: true, force: true })
  } catch {
    /* ignore — the directory is recreated on the next download */
  }
}
