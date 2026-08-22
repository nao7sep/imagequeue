import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { getDataDir } from './config-store'
import { encodeApiKey, decodeApiKey, isValidStoredApiKey } from './api-key'
import { log, serializeError } from '../logger'
import type { SecretId } from '../../shared/types'
import { utcStampForFilename } from '../../shared/utc-stamp'

// The secret store, realized per the fleet api-key-storage-conventions. Secrets
// live in their own file under the storage root (`~/.imagequeue/api-keys.json`),
// separate from config.json. The file is 0600 on POSIX, an environment value
// takes precedence over the stored value, and a corrupt/group-readable file is
// handled defensively on read.
//
// A key id is a dotted path of `[a-z0-9]` segments. Segment 0 is the conventional
// vendor/env name, so the environment variable derives from the segments with no
// mapping table: `gemini.text` → GEMINI_TEXT_API_KEY. Resolution is EXACT — a key
// is consulted only under its own full id, with no fallback to a shorter/bare
// provider key (the why is on resolveApiKey). The on-disk value is `obf:` + base64
// of the reversed UTF-8 bytes (encodeApiKey) — not encryption, just a guard against
// casual grep.

const SECRETS_FILE_MODE = 0o600
const ENFORCE_FILE_MODE = process.platform !== 'win32'
const KEY_ID_RE = /^[a-z0-9]+(\.[a-z0-9]+)*$/

// The key-id vocabulary (SecretId, SECRET_IDS, IMAGE_BACKEND_SECRET) lives in
// shared/types: the Settings form edits keys BY ID over their own IPC, so both
// sides of the boundary need it. This module owns the store mechanics only.

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

function envValue(segments: string[]): string {
  const value = process.env[apiKeyEnvVar(segments)]?.trim()
  return value ? value : ''
}

let modeWarned = false

// POSIX-only: tighten the secrets file back to 0600 every time it is found
// readable beyond the owner — a file widened mid-session (another process, a
// careless `chmod`) is re-tightened on its very next access, not left loose
// until restart. The warning is the once-per-session part: it is only ever
// noise after the first time, so only it is gated behind modeWarned; the
// chmod itself is unconditional. We warn rather than refuse so an existing key
// stays usable.
function warnIfInsecureMode(filePath: string): void {
  if (!ENFORCE_FILE_MODE) return
  try {
    const mode = fs.statSync(filePath).mode
    if ((mode & 0o077) !== 0) {
      if (!modeWarned) {
        modeWarned = true
        log('warn', 'API keys file is readable beyond the owner; tightening to 0600', {
          path: filePath,
          mode: (mode & 0o777).toString(8).padStart(3, '0')
        })
      }
      try {
        fs.chmodSync(filePath, SECRETS_FILE_MODE)
      } catch {
        // best-effort; the next access retries the tightening
      }
    }
  } catch {
    // No file yet, or stat failed — nothing to tighten.
  }
}


// Move the unreadable file aside to a timestamped neighbour (handled once, not
// re-flagged on every read), returning the new path or null on failure. The
// discriminator is hyphen-joined into the target's stem — `<stem>-<stamp>.invalid`
// — never a dot-appended `<file>.<stamp>.invalid`.
function moveAsideInvalid(filePath: string): string | null {
  const dir = path.dirname(filePath)
  const stem = path.basename(filePath, path.extname(filePath))
  const movedTo = path.join(dir, `${stem}-${utcStampForFilename()}.invalid`)
  try {
    fs.renameSync(filePath, movedTo)
    return movedTo
  } catch {
    return null
  }
}

// Validate the outer on-disk shape `{ keys: { id: value } }`, then canonicalize
// its entries: ids lowercased and matched against the id grammar, values kept
// only when strings. A wrong outer container is not the same thing as an empty
// valid store: returning null lets the reader preserve those original bytes
// before a later key edit writes a clean file.
function normalize(raw: unknown): SecretsFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rawKeys = (raw as { keys?: unknown }).keys
  if (!rawKeys || typeof rawKeys !== 'object' || Array.isArray(rawKeys)) return null
  const keys: Record<string, string> = {}
  for (const [id, value] of Object.entries(rawKeys as Record<string, unknown>)) {
    const canonical = id.toLowerCase()
    if (typeof value === 'string' && KEY_ID_RE.test(canonical)) keys[canonical] = value
  }
  return { keys }
}

function readSecretsFile(forMutation = false): SecretsFile {
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
    if (forMutation && !movedTo) {
      throw new Error('API keys file was unreadable and could not be preserved; it was left unchanged')
    }
    return { keys: {} }
  }
  try {
    const normalized = normalize(JSON.parse(text))
    if (normalized) return normalized
    const movedTo = moveAsideInvalid(filePath)
    log('warn', 'API keys file had the wrong shape; set aside and treating as empty', {
      path: filePath,
      movedTo,
    })
    if (forMutation && !movedTo) {
      throw new Error('API keys file had the wrong shape and could not be preserved; it was left unchanged')
    }
    return { keys: {} }
  } catch (err) {
    const movedTo = moveAsideInvalid(filePath)
    log('warn', 'API keys file is not valid JSON; set aside and treating as empty', {
      path: filePath,
      movedTo,
      error: serializeError(err)
    })
    if (forMutation && !movedTo) {
      throw new Error('API keys file was invalid and could not be preserved; it was left unchanged')
    }
    return { keys: {} }
  }
}

function writeSecretsFile(file: SecretsFile): void {
  const filePath = getSecretsPath()
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  // not recorded: api-keys.json is a SECRET and is never written through the managed-text hook. Secrets
  // are never recorded (data-backup conventions): a history containing a credential would become
  // sensitive-at-rest in its entirety and would have to be guarded as the secret is; keeping it out is
  // what keeps backups.sqlite3 no more sensitive than ordinary user text. A key lost to a wipe is
  // re-entered by the user. This write deliberately does its own 0600 temp+rename rather than routing
  // through writeFileAtomic — the separate path is itself the exclusion, by construction.
  const stem = path.basename(filePath, path.extname(filePath))
  const tempPath = path.join(dir, `${stem}-${nanoid()}.tmp`)
  fs.writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, { mode: SECRETS_FILE_MODE })
  if (ENFORCE_FILE_MODE) fs.chmodSync(tempPath, SECRETS_FILE_MODE)
  fs.renameSync(tempPath, filePath)
}

// A stored value that fails the canonical `obf:` shape check is malformed —
// Node's lenient base64 decoder would otherwise turn it into non-empty garbage
// sent to the provider as a key. Treated as absent (never thrown), with one
// warn naming the key id so a hand-edit gone wrong is visible in the log
// instead of silently degrading to a garbage key.
function warnMalformedStoredKey(keyId: string): void {
  log('warn', 'Stored API key value is malformed; treating as absent', { keyId })
}

// Resolve the plaintext key for a secret id: the environment value for its EXACT
// id first, then the stored value for that exact id, trimmed, or '' ("not
// configured"). There is deliberately NO fallback to a shorter/bare provider key.
//
// This is NOT a deviation: the api-key-storage convention specifies exact-only
// resolution as its `fallback: false` mode. imagequeue takes that mode for every
// key rather than per call site, because every openai/gemini key here is
// purpose-scoped (openai.text vs openai.image, gemini.text vs gemini.nanobanana),
// so a bare `openai`/`gemini` — or an ambient OPENAI_API_KEY/GEMINI_API_KEY exported
// for some other tool — is never a key the user set *here*. Falling back to it would
// light up one of four billed backends the user never configured in this app.
// Exact-only keeps one key bound to one backend; env injection uses the exact var
// (OPENAI_IMAGE_API_KEY, GEMINI_NANOBANANA_API_KEY, …). No `fallback` parameter
// exists here on purpose: an unused option is one a later call site can pass to
// reopen exactly that hazard.
export function resolveApiKey(id: SecretId): string {
  const fromEnv = envValue(id.split('.'))
  if (fromEnv) return fromEnv
  const stored = readSecretsFile().keys[id]
  if (typeof stored !== 'string' || !stored) return ''
  if (!isValidStoredApiKey(stored)) {
    warnMalformedStoredKey(id)
    return ''
  }
  return decodeApiKey(stored).trim()
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
  if (!stored) return ''
  if (!isValidStoredApiKey(stored)) {
    warnMalformedStoredKey(id)
    return ''
  }
  return decodeApiKey(stored).trim()
}

// Persist (or clear, when value is blank) the stored key for a secret id.
export function setStoredApiKey(id: SecretId, value: string): void {
  const file = readSecretsFile(true)
  const trimmed = value.trim()
  if (trimmed.length > 0) {
    file.keys[id] = encodeApiKey(trimmed)
  } else {
    delete file.keys[id]
  }
  writeSecretsFile(file)
}
