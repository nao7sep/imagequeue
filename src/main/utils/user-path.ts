import os from 'os'
import path from 'path'

/**
 * Expand a user-typed path per the storage-path conventions: `~` / `~/` (and
 * `~\`) to the home directory, `$VAR` and `%VAR%` to their environment
 * values, then resolve anything still relative against `relativeBase` — a
 * relative string must never reach the filesystem, where it would resolve
 * against process.cwd(), which is `/` for a double-clicked app.
 *
 * `~user` deliberately does NOT expand (the old bare-`~` replace turned it
 * into `<home>user`, a corruption worse than passing it through).
 */
export function expandUserPath(raw: string, relativeBase: string): string {
  let expanded = raw.trim()
  if (expanded === '~') expanded = os.homedir()
  else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(os.homedir(), expanded.slice(2))
  }
  expanded = expanded
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name) => process.env[name] ?? m)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => process.env[name] ?? m)
  const absolute = path.isAbsolute(expanded) ? expanded : path.join(relativeBase, expanded)
  return path.normalize(absolute)
}

// Picker results and stored absolute references are filesystem paths, not expressions.
// Relative, tilde and environment-led settings retain their authored syntax.
export function resolveSettingsPath(raw: string, relativeBase: string): string {
  return path.isAbsolute(raw) ? raw : expandUserPath(raw, relativeBase)
}
