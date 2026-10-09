import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { getDataDir } from './config-store'
import { encodeApiKey, decodeApiKey, isValidStoredApiKey } from './api-key'
import { log, serializeError } from '../logger'
import type { SecretId } from '../../shared/types'
import type { AppNotice } from '../../shared/app-notice'
import { FORMAT_VERSION_KEY, FORMAT_VERSIONS, markFormat, NewerFormatError } from '../store-format'
import { holdsBytes } from '../utils/holds-bytes'
import { raiseAppNotice } from '../app-notices'
import { apiKeysUnavailablePresentation, newerFilePresentation } from '../failure-presentation'

// The secret store, realized per the fleet api-key-storage-conventions. Secrets
// live in their own file under the storage root (`~/.imagequeue/api-keys.json`),
// separate from config.json. The file is 0600 on POSIX, an environment value
// takes precedence over the stored value, and reading it never moves or rewrites
// it: a file that cannot be used makes its keys unavailable and refuses saves
// until the user repairs or removes it (api-key-storage-conventions, Recovery
// and replacement).
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

// The key-id vocabulary (SecretId, SECRET_IDS, IMAGE_BACKEND_SECRET) lives in
// shared/types: the Settings form edits keys BY ID over their own IPC, so both
// sides of the boundary need it. This module owns the store mechanics only.

// The file as it was read: `keys` holds every entry, whatever it holds, so an
// entry this build cannot use is written back as it is; `others` holds every
// other key the file carries beside its format version.
interface SecretsFile {
  keys: Record<string, unknown>
  others: Record<string, unknown>
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

// Why the file cannot be used.
type Unusable = { kind: 'unreadable' | 'malformed' | 'newer'; error: unknown }

// The outer shape `{ keys: { id: value } }`, its format version optional: a
// file written before the version was added is current.
function parseSecrets(raw: unknown, filePath: string): SecretsFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('api-keys.json must be a JSON object')
  const { [FORMAT_VERSION_KEY]: version, keys, ...others } = raw as Record<string, unknown>
  if (version !== undefined) {
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
      throw new Error(`${FORMAT_VERSION_KEY} is not a positive integer`)
    }
    if (version > FORMAT_VERSIONS.apiKeys) throw new NewerFormatError(filePath, version, FORMAT_VERSIONS.apiKeys)
  }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('api-keys.json must hold a keys map')
  return { keys: { ...(keys as Record<string, unknown>) }, others }
}

function readSecretsFile(): { file: SecretsFile } | { file: null; unusable: Unusable } {
  const filePath = getSecretsPath()
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { file: { keys: {}, others: {} } }
    return { file: null, unusable: { kind: 'unreadable', error: err } }
  }
  try {
    const file = parseSecrets(JSON.parse(text), filePath)
    warnIfInsecureMode(filePath)
    return { file }
  } catch (err) {
    return { file: null, unusable: { kind: err instanceof NewerFormatError ? 'newer' : 'malformed', error: err } }
  }
}

function unusableNotice(filePath: string, unusable: Unusable): AppNotice {
  return unusable.kind === 'newer' ? newerFilePresentation(filePath) : apiKeysUnavailablePresentation(filePath)
}

let unusableReported = false

// A file that cannot be used reads as holding no keys. The first time in a
// launch, that is logged and the user is told which file it is.
function readableKeys(): Record<string, unknown> {
  const read = readSecretsFile()
  if (read.file) return read.file.keys
  if (!unusableReported) {
    unusableReported = true
    const filePath = getSecretsPath()
    log('warn', 'API keys file cannot be used; its keys are unavailable and it was left unchanged', {
      path: filePath,
      problem: read.unusable.kind,
      error: serializeError(read.unusable.error),
    })
    raiseAppNotice(unusableNotice(filePath, read.unusable))
  }
  return {}
}

/** A key save refused because api-keys.json cannot be used; the file is unchanged. */
export class ApiKeysUnavailableError extends Error {
  constructor(readonly path: string, options: { cause: unknown }) {
    super(`The API keys file could not be used, so the key was not saved and the file was left unchanged: ${path}`, options)
    this.name = 'ApiKeysUnavailableError'
  }
}

// The stored entry for an id: an exact match first, then one whose id differs
// only in case, as the file may have been edited by hand.
function storedEntry(keys: Record<string, unknown>, id: SecretId): unknown {
  if (Object.hasOwn(keys, id)) return keys[id]
  const match = Object.keys(keys).find((stored) => stored.toLowerCase() === id)
  return match === undefined ? undefined : keys[match]
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
  const content = Buffer.from(`${JSON.stringify(markFormat({ ...file.others, keys: file.keys }, FORMAT_VERSIONS.apiKeys), null, 2)}\n`, 'utf-8')
  if (holdsBytes(filePath, content)) return
  const stem = path.basename(filePath, path.extname(filePath))
  const tempPath = path.join(dir, `${stem}-${nanoid()}.tmp`)
  let owned = false
  try {
    const descriptor = fs.openSync(tempPath, 'wx', SECRETS_FILE_MODE)
    owned = true
    try {
      fs.writeFileSync(descriptor, content)
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.renameSync(tempPath, filePath)
  } finally {
    if (owned) {
      try { fs.rmSync(tempPath, { force: true }) } catch { /* Preserve the save's cause. */ }
    }
  }
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
  const stored = storedEntry(readableKeys(), id)
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
  const stored = storedEntry(readableKeys(), id)
  if (typeof stored !== 'string' || !stored) return ''
  if (!isValidStoredApiKey(stored)) {
    warnMalformedStoredKey(id)
    return ''
  }
  return decodeApiKey(stored).trim()
}

// Persist (or clear, when value is blank) the stored key for a secret id. Every
// other entry is written back as it was. A file that cannot be used refuses the
// save, tells the user which file it is, and stays exactly as it is.
export function setStoredApiKey(id: SecretId, value: string): void {
  const read = readSecretsFile()
  if (!read.file) {
    const filePath = getSecretsPath()
    raiseAppNotice(unusableNotice(filePath, read.unusable))
    throw new ApiKeysUnavailableError(filePath, { cause: read.unusable.error })
  }
  const { file } = read
  for (const stored of Object.keys(file.keys)) {
    if (stored !== id && stored.toLowerCase() === id) delete file.keys[stored]
  }
  const trimmed = value.trim()
  if (trimmed.length > 0) {
    file.keys[id] = encodeApiKey(trimmed)
  } else {
    delete file.keys[id]
  }
  writeSecretsFile(file)
}
