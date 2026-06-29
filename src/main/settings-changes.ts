import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../shared/types'
import { IMAGE_BACKEND_SECRET, type SecretId } from './config/api-keys-store'

// The pure changed-field diff and secret routing behind settings:saveChangedFields,
// split out of the Electron IPC shell so it can be tested against plain objects.
// The diff mutates the config object in place for ordinary fields and *returns*
// the api-key writes to route to the separate 0600 secrets store, rather than
// performing that side effect itself — the IPC handler executes the returned
// writes. No Electron, fs, or secrets store is touched here.

const settingsRootFields = new Set<string>([
  'text_ai',
  'general',
  'image_backends',
  'notifications',
  'prompts',
])

// API keys are NOT stored in config.json. Each config path the UI binds to an
// api_key field maps to a SecretId in the separate store; a changed value is
// routed there and never allowed to reach config.json.
const apiKeyConfigPathToSecret = new Map<string, SecretId>([
  ['text_ai.gemini.api_key', 'gemini.text'],
  ['text_ai.openai.api_key', 'openai.text'],
  ...CLOUD_BACKEND_IDS_IN_UI_ORDER.map(
    (backend) => [`image_backends.${backend}.api_key`, IMAGE_BACKEND_SECRET[backend]] as const
  ),
])

export interface SecretWrite {
  secret: SecretId
  value: string
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Structural deep equality. Unlike `JSON.stringify(a) === JSON.stringify(b)`,
// this is insensitive to object key order (the renderer may send keys in a
// different order than config.json stores them) and counts an explicit
// `undefined`-valued key as a real difference rather than silently dropping it.
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => valuesEqual(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && valuesEqual(a[key], b[key])
    )
  }
  return false
}

/**
 * Walk the base→next diff, applying every changed ordinary field into `target`
 * (the live config) and collecting the api-key changes to route to the secrets
 * store. Returns those secret writes; `target` is mutated in place. Throws when
 * a top-level section outside the supported set is changed.
 */
export function applyChangedFields(
  target: Record<string, unknown>,
  base: unknown,
  next: unknown
): SecretWrite[] {
  const secrets: SecretWrite[] = []
  walkChangedFields(target, base, next, [], secrets)
  return secrets
}

function walkChangedFields(
  target: Record<string, unknown>,
  base: unknown,
  next: unknown,
  pathParts: string[],
  secrets: SecretWrite[]
): void {
  if (valuesEqual(base, next)) return

  if (pathParts.length === 0) {
    if (!isPlainObject(next)) throw new Error('Settings changes must be an object')
    for (const key of Object.keys(next)) {
      const baseValue = isPlainObject(base) ? base[key] : undefined
      if (!settingsRootFields.has(key)) {
        if (valuesEqual(baseValue, next[key])) continue
        throw new Error(`Cannot save unsupported settings section: ${key}`)
      }
      walkChangedFields(target, baseValue, next[key], [key], secrets)
    }
    return
  }

  if (isPlainObject(next)) {
    for (const key of Object.keys(next)) {
      walkChangedFields(target, isPlainObject(base) ? base[key] : undefined, next[key], [...pathParts, key], secrets)
    }
    return
  }

  setConfigPath(target, pathParts, next, secrets)
}

function setConfigPath(
  target: Record<string, unknown>,
  pathParts: string[],
  value: unknown,
  secrets: SecretWrite[]
): void {
  if (pathParts.length === 0) return
  // API keys are diverted to the separate 0600 secrets file and never written
  // into config.json. A blank value clears the stored key.
  const secret = apiKeyConfigPathToSecret.get(pathParts.join('.'))
  if (secret) {
    secrets.push({ secret, value: String(value ?? '') })
    return
  }
  let cursor = target
  for (const part of pathParts.slice(0, -1)) {
    const next = cursor[part]
    if (!isPlainObject(next)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[pathParts[pathParts.length - 1]] = value
}
