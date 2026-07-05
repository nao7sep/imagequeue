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

// Expand `$VAR` / `${VAR}` (POSIX) and `%VAR%` (Windows) references against the
// current environment. An undefined reference expands to empty, matching shell
// behavior, rather than being left as a literal that would become a directory
// name — this is what lets the empty-after-expansion check below catch BOTH an
// unset reference and one a caller set to "" explicitly, uniformly, instead of
// only catching the latter. Mirrors the reference implementation in
// mumbler/tapebox.
function expandEnvReferences(value: string): string {
  return value.replace(/\$(\w+)|\$\{(\w+)\}|%(\w+)%/g, (_match, a, b, c) => {
    const name = a ?? b ?? c
    return process.env[name] ?? ''
  })
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
    let expanded = expandEnvReferences(trimmed).trim()

    // An override that is set but expands to nothing — an unset $VAR/%VAR%, or
    // one explicitly set to "" — is a misconfiguration, not a usable path.
    // resolve(homeDir, "") collapses onto the bare home directory, which would
    // silently materialize the app's files directly in $HOME and walk $HOME as
    // its own backup root. Reject it as a startup error instead of falling
    // back to that (or to the default root) silently.
    if (expanded.length === 0) {
      throw new Error(
        `${HOME_ENV_VAR} is set to "${override}" but expands to an empty path ` +
          `(an unset $VAR/%VAR%?). Set it to a usable directory, or unset it to use ~/${DEFAULT_DIR_NAME}.`
      )
    }

    // Expand a leading `~` / `~/` (and `~\` on Windows) to the home directory.
    if (expanded === '~') {
      expanded = homeDir
    } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
      expanded = path.join(homeDir, expanded.slice(2))
    }

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
