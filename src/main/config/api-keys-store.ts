import fs from 'fs'
import path from 'path'
import { getDataDir } from './config-store'
import { encodeApiKey, decodeApiKey } from './api-key'
import { log, serializeError } from '../logger'

// Secrets live in their own file under the storage root, separate from
// config.json, per the storage-path conventions. The file is 0600 on POSIX, an
// environment value takes precedence over the stored value, and a
// group/world-readable file is warned about (and tightened) on read.
//
// The on-disk value is still base64-and-reversed (encodeApiKey) — that is not a
// security measure, just a guard against casual grep discovery; the 0600 mode is
// the actual access control. The separate-file + 0600 + env-first behavior is
// the conformance the convention requires.

const SECRETS_FILE_MODE = 0o600
const ENFORCE_FILE_MODE = process.platform !== 'win32'

// The set of API keys the app stores. Each id maps to the env var(s) that
// override the stored value (checked in order; the first non-empty wins).
export type SecretId =
  | 'text_ai.gemini'
  | 'text_ai.openai'
  | 'image.openai'
  | 'image.imagen'
  | 'image.nanobanana'
  | 'image.grok'
  | 'image.flux'

// Env-first resolution. The first var listed is the app-specific designated
// name; the second (where present) is the provider's conventional name, so a
// user who already exports e.g. OPENAI_API_KEY is honored without extra config.
const SECRET_ENV_VARS: Record<SecretId, readonly string[]> = {
  'text_ai.gemini': ['IMAGEQUEUE_GEMINI_API_KEY', 'GEMINI_API_KEY'],
  'text_ai.openai': ['IMAGEQUEUE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  'image.openai': ['IMAGEQUEUE_OPENAI_IMAGE_API_KEY', 'OPENAI_API_KEY'],
  'image.imagen': ['IMAGEQUEUE_IMAGEN_API_KEY', 'GEMINI_API_KEY'],
  'image.nanobanana': ['IMAGEQUEUE_NANOBANANA_API_KEY', 'GEMINI_API_KEY'],
  'image.grok': ['IMAGEQUEUE_GROK_API_KEY', 'XAI_API_KEY'],
  'image.flux': ['IMAGEQUEUE_FLUX_API_KEY', 'BFL_API_KEY']
}

export const SECRET_IDS = Object.keys(SECRET_ENV_VARS) as SecretId[]

type SecretsFile = Partial<Record<SecretId, string>>

function getSecretsPath(): string {
  return path.join(getDataDir(), 'api-keys.json')
}

function envValueFor(id: SecretId): string | null {
  for (const name of SECRET_ENV_VARS[id]) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

let modeWarned = false

// POSIX-only: warn once if the secrets file is readable beyond the owner, and
// tighten it. We warn rather than refuse so an existing key stays usable.
function warnIfInsecureMode(filePath: string): void {
  if (!ENFORCE_FILE_MODE || modeWarned) return
  try {
    const mode = fs.statSync(filePath).mode
    if ((mode & 0o077) !== 0) {
      modeWarned = true
      log('warn', 'API keys file is readable beyond the owner; tightening to 0600', {
        path: filePath,
        mode: (mode & 0o777).toString(8).padStart(3, '0')
      })
      try {
        fs.chmodSync(filePath, SECRETS_FILE_MODE)
      } catch {
        // best-effort; the next write re-applies 0600
      }
    }
  } catch {
    // No file yet, or stat failed — nothing to warn about.
  }
}

function readSecretsFile(): SecretsFile {
  const filePath = getSecretsPath()
  warnIfInsecureMode(filePath)
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log('warn', 'Failed to read API keys file; treating as empty', {
        path: filePath,
        error: serializeError(err)
      })
    }
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: SecretsFile = {}
    for (const id of SECRET_IDS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (typeof value === 'string') result[id] = value
    }
    return result
  } catch (err) {
    log('warn', 'API keys file is not valid JSON; treating as empty', {
      path: filePath,
      error: serializeError(err)
    })
    return {}
  }
}

function writeSecretsFile(file: SecretsFile): void {
  const filePath = getSecretsPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // Write to a temp file at 0600 then atomically rename over the target, so a
  // crash mid-write cannot corrupt the secrets file and the target never exists
  // with broader permissions.
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, { mode: SECRETS_FILE_MODE })
  if (ENFORCE_FILE_MODE) fs.chmodSync(tempPath, SECRETS_FILE_MODE)
  fs.renameSync(tempPath, filePath)
}

// Resolve the plaintext key for a secret id: an environment value wins, else the
// decoded stored value, else empty string ('' meaning "not configured").
export function resolveApiKey(id: SecretId): string {
  const env = envValueFor(id)
  if (env) return env
  const stored = readSecretsFile()[id]
  return stored ? decodeApiKey(stored) : ''
}

// True when a usable key resolves from the environment or the stored file.
export function hasApiKey(id: SecretId): boolean {
  return resolveApiKey(id).length > 0
}

// Returns the stored (non-environment) plaintext key, for the settings UI to
// display/edit. The environment override is deliberately NOT surfaced here so
// editing the stored value never silently overwrites an env-supplied key.
export function getStoredApiKey(id: SecretId): string {
  const stored = readSecretsFile()[id]
  return stored ? decodeApiKey(stored) : ''
}

// Persist (or clear, when value is empty) the stored key for a secret id.
export function setStoredApiKey(id: SecretId, value: string): void {
  const file = readSecretsFile()
  if (value && value.length > 0) {
    file[id] = encodeApiKey(value)
  } else {
    delete file[id]
  }
  writeSecretsFile(file)
}
