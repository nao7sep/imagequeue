/**
 * Pure mapping from a file's path on disk to its entry path within the archive. ImageQueue keeps all of
 * its managed data directly under `~/.imagequeue/` (no external roots), so the archive is a faithful image
 * of that tree: every home-root file maps straight to its relative path. All entry paths use forward
 * slashes.
 */

/** Normalizes a filesystem-relative path to a forward-slash archive path. */
export function normalize(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

/** A file directly under `~/.imagequeue/`: its relative path is the archive path (`config.json`). */
export function forHomeFile(relativePath: string): string {
  return normalize(relativePath)
}
