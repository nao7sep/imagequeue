import fs from 'fs'
import path from 'path'
import { getDataDir } from './config-store'
import { encodeApiKey, decodeApiKey } from './api-key'
import { log, serializeError } from '../logger'

// The secret store, realized per the fleet api-key-storage-conventions. Secrets
// live in their own file under the storage root (`~/.imagequeue/api-keys.json`),
// separate from config.json. The file is 0600 on POSIX, an environment value
// takes precedence over the stored value, and a corrupt/group-readable file is
// handled defensively on read.
//
// A key id is a dotted path of `[a-z0-9]` segments. Segment 0 is the conventional
// vendor/env name, so the environment variable derives from the segments with no
// mapping table: `gemini.text` → GEMINI_TEXT_API_KEY (falling back to
// GEMINI_API_KEY). The on-disk value is `obf:` + base64 of the reversed UTF-8
// bytes (encodeApiKey) — not encryption, just a guard against casual grep.

const SECRETS_FILE_MODE = 0o600
const ENFORCE_FILE_MODE = process.platform !== 'win32'
const KEY_ID_RE = /^[a-z0-9]+(\.[a-z0-9]+)*$/

// The api keys the app stores. The id is the vendor segment + an optional purpose
// segment; the environment name and stored key derive from it directly. Image
// backends keyed by product (grok/flux) map to their vendor key id below — the
// backend keeps its product identity; only the key is vendor-conventional.
export type SecretId =
  | 'gemini.text'
  | 'openai.text'
  | 'openai.image'
  | 'gemini.imagen'
  | 'gemini.nanobanana'
  | 'xai'
  | 'bfl'

export const SECRET_IDS: SecretId[] = [
  'gemini.text',
  'openai.text',
  'openai.image',
  'gemini.imagen',
  'gemini.nanobanana',
  'xai',
  'bfl'
]

// Image backend id (product) → the vendor key id its key is stored/resolved under.
// `grok` is xAI's product, `flux` is Black Forest Labs' — the backend keeps its
// product name everywhere; only the API key is the conventional vendor segment.
export const IMAGE_BACKEND_SECRET: Record<string, SecretId> = {
  openai: 'openai.image',
  imagen: 'gemini.imagen',
  nanobanana: 'gemini.nanobanana',
  grok: 'xai',
  flux: 'bfl'
}

interface SecretsFile {
  keys: Record<string, string>
}

function getSecretsPath(): string {
  return path.join(getDataDir(), 'api-keys.json')
}

// Env var name from segments: uppercased, joined by '_', suffixed '_API_KEY'.
function apiKeyEnvVar(segments: string[]): string {
  return `${segments.map((s) => s.toUpperCase()).join('_')}_API_KEY`
}

// Prefixes of a segment list, most specific first: [a,b] → [[a,b],[a]].
function prefixes(segments: string[]): string[][] {
  const out: string[][] = []
  for (let n = segments.length; n >= 1; n--) out.push(segments.slice(0, n))
  return out
}

function envValue(segments: string[]): string {
  const value = process.env[apiKeyEnvVar(segments)]?.trim()
  return value ? value : ''
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
    // No file yet, or stat failed — nothing to tighten.
  }
}

function utcStampForFilename(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-utc`
  )
}

// Move the unreadable file aside to a timestamped neighbour (handled once, not
// re-flagged on every read), returning the new path or null on failure.
function moveAsideInvalid(filePath: string): string | null {
  const movedTo = `${filePath}.${utcStampForFilename()}.invalid`
  try {
    fs.renameSync(filePath, movedTo)
    return movedTo
  } catch {
    return null
  }
}

// Canonicalize the on-disk shape `{ keys: { id: value } }`: ids lowercased and
// matched against the id grammar, values kept only when strings.
function normalize(raw: unknown): SecretsFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { keys: {} }
  const rawKeys = (raw as { keys?: unknown }).keys
  if (!rawKeys || typeof rawKeys !== 'object' || Array.isArray(rawKeys)) return { keys: {} }
  const keys: Record<string, string> = {}
  for (const [id, value] of Object.entries(rawKeys as Record<string, unknown>)) {
    const canonical = id.toLowerCase()
    if (typeof value === 'string' && KEY_ID_RE.test(canonical)) keys[canonical] = value
  }
  return { keys }
}

function readSecretsFile(): SecretsFile {
  const filePath = getSecretsPath()
  warnIfInsecureMode(filePath)
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { keys: {} }
    const movedTo = moveAsideInvalid(filePath)
    log('warn', 'API keys file was unreadable; set aside and treating as empty', {
      path: filePath,
      movedTo,
      error: serializeError(err)
    })
    return { keys: {} }
  }
  try {
    return normalize(JSON.parse(text))
  } catch (err) {
    const movedTo = moveAsideInvalid(filePath)
    log('warn', 'API keys file is not valid JSON; set aside and treating as empty', {
      path: filePath,
      movedTo,
      error: serializeError(err)
    })
    return { keys: {} }
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

// Resolve the plaintext key for a secret id, source-first (environment then
// stored, most→least specific), trimmed, or '' ('' meaning "not configured").
export function resolveApiKey(id: SecretId): string {
  const levels = prefixes(id.split('.'))
  for (const level of levels) {
    const fromEnv = envValue(level)
    if (fromEnv) return fromEnv
  }
  const file = readSecretsFile()
  for (const level of levels) {
    const stored = file.keys[level.join('.')]
    if (typeof stored === 'string') {
      const key = decodeApiKey(stored).trim()
      if (key) return key
    }
  }
  return ''
}

// True when a usable key resolves from the environment or the stored file.
export function hasApiKey(id: SecretId): boolean {
  return resolveApiKey(id).length > 0
}

// The stored (non-environment) plaintext key for the exact id, for the settings
// UI to display/edit. The environment override is deliberately NOT surfaced here,
// and there is no fallback — editing is per exact id.
export function getStoredApiKey(id: SecretId): string {
  const stored = readSecretsFile().keys[id]
  return stored ? decodeApiKey(stored).trim() : ''
}

// Persist (or clear, when value is blank) the stored key for a secret id.
export function setStoredApiKey(id: SecretId, value: string): void {
  const file = readSecretsFile()
  const trimmed = value.trim()
  if (trimmed.length > 0) {
    file.keys[id] = encodeApiKey(trimmed)
  } else {
    delete file.keys[id]
  }
  writeSecretsFile(file)
}
