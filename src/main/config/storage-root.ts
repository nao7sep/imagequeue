import fs from 'fs'
import os from 'os'
import path from 'path'

// Resolves the single storage root per the storage-path conventions. The root
// is the IMAGEQUEUE_HOME override when it is set and non-empty (its value is
// expanded for `~` and environment references, then made absolute against the
// HOME directory — never the working directory), otherwise the default
// `~/.imagequeue`. An override that cannot be created/used is a reported startup
// error, never a silent fallback to the default.
//
// Resolved lazily (called on demand, not frozen into a module constant at import
// time) so the environment is fully known by the time the root is computed.

const HOME_ENV_VAR = 'IMAGEQUEUE_HOME'
const DEFAULT_DIR_NAME = '.imagequeue'

// Expand a leading `~`/`~/` against the home directory and any `$VAR` / `%VAR%`
// environment references. Applied to the override value only.
function expandHome(value: string, homeDir: string): string {
  let expanded = value
  if (expanded === '~') {
    expanded = homeDir
  } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(homeDir, expanded.slice(2))
  }
  expanded = expanded.replace(/\$(\w+)|\$\{(\w+)\}|%(\w+)%/g, (match, a, b, c) => {
    const name = a ?? b ?? c
    const env = process.env[name]
    return env === undefined ? match : env
  })
  return expanded
}

// Resolve the storage root, honoring IMAGEQUEUE_HOME. A relative override is
// made absolute against the HOME directory (never process.cwd()); the default
// root is `<homeDir>/.imagequeue`. The chosen root is created (mkdir -p); if it
// cannot be created or is not a usable directory, this throws a clear startup
// error and does not fall back.
export function resolveStorageRoot(): string {
  const homeDir = os.homedir()
  const override = process.env[HOME_ENV_VAR]
  const trimmed = typeof override === 'string' ? override.trim() : ''

  let root: string
  let fromOverride = false
  if (trimmed.length > 0) {
    fromOverride = true
    const expanded = expandHome(trimmed, homeDir)
    root = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(homeDir, expanded)
  } else {
    root = path.join(homeDir, DEFAULT_DIR_NAME)
  }

  try {
    fs.mkdirSync(root, { recursive: true })
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`path exists but is not a directory: ${root}`)
    }
  } catch (error) {
    const source = fromOverride ? `${HOME_ENV_VAR} (${override})` : 'default storage root'
    throw new Error(
      `Failed to create or use the ImageQueue storage root from ${source} at "${root}": ${(error as Error).message}`,
      { cause: error }
    )
  }

  return root
}
