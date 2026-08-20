// The pure changed-field diff behind settings:saveChangedFields, split out of the
// Electron IPC shell so it can be tested against plain objects. It mutates the
// config object in place and touches no Electron, fs, or store. API keys never
// reach it: they are not part of the config type or its payload, and the Settings
// form saves them by key id over settings:saveApiKeys.

const settingsRootFields = new Set<string>([
  'text_ai',
  'general',
  'image_backends',
  'notifications',
  'prompts',
])

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
 * Walk the base→next diff, applying every changed field into `target` (the live
 * config), which is mutated in place. Throws when a top-level section outside
 * the supported set is changed.
 */
export function applyChangedFields(
  target: Record<string, unknown>,
  base: unknown,
  next: unknown
): void {
  walkChangedFields(target, base, next, [])
}

function walkChangedFields(
  target: Record<string, unknown>,
  base: unknown,
  next: unknown,
  pathParts: string[]
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
      walkChangedFields(target, baseValue, next[key], [key])
    }
    return
  }

  if (isPlainObject(next)) {
    for (const key of Object.keys(next)) {
      // Trust boundary: keys come from the renderer's payload. A __proto__ /
      // constructor / prototype segment would make the cursor walk below land
      // on Object.prototype (which passes isPlainObject) and turn the final
      // assignment into main-process prototype pollution — reachable only from
      // a compromised renderer, which is exactly what this module's top-level
      // allowlist exists to contain.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error(`Cannot save settings path containing reserved key: ${key}`)
      }
      walkChangedFields(target, isPlainObject(base) ? base[key] : undefined, next[key], [...pathParts, key])
    }
    return
  }

  setConfigPath(target, pathParts, next)
}

function setConfigPath(
  target: Record<string, unknown>,
  pathParts: string[],
  value: unknown
): void {
  if (pathParts.length === 0) return
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
