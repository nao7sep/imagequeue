import type { AppConfig, BrainstormConfig } from './types'
import type { TextAIBackendId } from '../../shared/types'
import { createDefaultConfig } from './defaults'
import { isLanguage } from '../../shared/i18n/languages'
import { AI_ROLES, TEXT_PROVIDERS, textRowFor } from '../../shared/ai-models'
import { multiline, singleLine } from '../../shared/textCleanup'
import { valuesEqual } from '../settings-changes'

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// The persisted boundaries are independent of the effective config's convenient
// model/default_params siblings used by generation code.
export function configSetDefaults(): Record<string, unknown> {
  const config = createDefaultConfig()
  const sets: Record<string, unknown> = {}
  for (const section of ['general', 'notifications'] as const) {
    for (const [key, value] of Object.entries(config[section])) sets[`${section}.${key}`] = value
  }
  sets.provider = config.provider
  for (const provider of ['gemini', 'openai'] as const) {
    for (const [key, value] of Object.entries(config[provider])) {
      if (key !== 'thinking') sets[`${provider}.${key}`] = value
    }
    for (const role of AI_ROLES) sets[`${provider}.thinking.${role.id}`] = config[provider].thinking[role.id]
  }
  for (const [id, backend] of Object.entries(config.image_backends)) {
    for (const [key, value] of Object.entries(backend)) {
      if (id !== 'drawthings' && (key === 'model' || key === 'default_params')) continue
      sets[`image_backends.${id}.${key}`] = value
    }
    if (id !== 'drawthings') {
      const cloud = backend as { model: string; default_params: unknown }
      sets[`image_backends.${id}.defaults`] = { model: cloud.model, default_params: cloud.default_params }
    }
  }
  sets['prompts.slug'] = config.prompts.slug
  // Each brainstorm value is its own set, so a number that fails its check
  // cannot take the authored templates down with it. They are stored where the
  // earlier single brainstorm set kept them, so that set reads without change.
  for (const [key, value] of Object.entries(config.brainstorm)) sets[`brainstorm.${key}`] = value
  return sets
}

export function readPath(object: unknown, key: string): unknown {
  let value = object
  for (const part of key.split('.')) value = isObject(value) ? value[part] : undefined
  return value
}

export function writePath(object: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  let cursor = object
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = structuredClone(value)
}

export function readConfigSet(config: AppConfig, key: string): unknown {
  if (key.endsWith('.defaults')) {
    const backend = readPath(config, key.slice(0, -'.defaults'.length)) as { model: string; default_params: unknown }
    return { model: backend.model, default_params: backend.default_params }
  }
  return readPath(config, key)
}

export function applyConfigSet(config: AppConfig, key: string, value: unknown): void {
  if (key.endsWith('.defaults')) {
    const parent = key.slice(0, -'.defaults'.length)
    const cluster = value as { model: string; default_params: unknown }
    writePath(config as unknown as Record<string, unknown>, `${parent}.model`, cluster.model)
    writePath(config as unknown as Record<string, unknown>, `${parent}.default_params`, cluster.default_params)
  } else writePath(config as unknown as Record<string, unknown>, key, value)
}

// The ranges the app's own code requires.
function meetsAppMinimum(key: string, value: number): boolean {
  if (key.endsWith('.concurrency')) return value >= 1
  if (key.endsWith('.timeout_ms')) return value > 0
  return true
}

// Shape and the app's own minimums: provider limits and current model support
// belong to the feature.
export function hasSetShape(value: unknown, builtIn: unknown, key = ''): boolean {
  if (key === 'general.theme') return ['system', 'light', 'dark'].includes(String(value))
  if (key === 'general.language') return value === 'system' || isLanguage(value)
  if (key === 'provider') return value === 'gemini' || value === 'openai'
  // An image column's model and its parameters. Which parameters a model takes,
  // and their values, are the column's to judge per row, so a record saved for a
  // model or a field that has since changed still loads.
  if (key.endsWith('.defaults')) {
    if (!isObject(value) || typeof value.model !== 'string' || !isObject(value.default_params)) return false
    return Object.values(value.default_params).every((item) =>
      item === null || typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))
  }
  if (builtIn === null) return value === null || (typeof value === 'number' && Number.isFinite(value))
  if (Array.isArray(builtIn)) return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
  if (isObject(builtIn)) {
    return isObject(value) && Object.entries(builtIn).every(([member, expected]) => hasSetShape(value[member], expected, `${key}.${member}`))
  }
  return typeof value === typeof builtIn && (typeof value !== 'number' || (Number.isFinite(value) && meetsAppMinimum(key, value)))
}

const MODEL_ID_SETS = new Set<string>(TEXT_PROVIDERS.flatMap((provider) => AI_ROLES.map((role) => `${provider}.${role.id}`)))
const THINKING_SETS = new Map<string, { provider: TextAIBackendId; role: (typeof AI_ROLES)[number] }>(
  TEXT_PROVIDERS.flatMap((provider) => AI_ROLES.map((role) => [`${provider}.thinking.${role.id}`, { provider, role }] as const)))
// Filesystem paths are identity values, stored and compared exactly as given.
const PATH_SETS = new Set<string>([
  'general.export_dir', 'notifications.success_file', 'notifications.failure_file', 'image_backends.drawthings.models_dir',
])

function cleanEach(record: Record<string, string>, clean: (text: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, text]) => [key, clean(text)]))
}

// A set's text as it is compared and stored (text-cleanup-conventions): bodies
// multiline, scalars single-line. Paths and image backend clusters are stored
// as given.
// Expects a value of the set's shape.
export function cleanConfigSet(key: string, value: unknown): unknown {
  if (key === 'prompts.slug') return multiline(value as string)
  if (key === 'brainstorm.templates') {
    return cleanEach(value as BrainstormConfig['templates'] as unknown as Record<string, string>, (text) => multiline(text))
  }
  if (key === 'brainstorm.format_directives') {
    const directives = value as BrainstormConfig['format_directives']
    return {
      formats: cleanEach(directives.formats, (text) => singleLine(text)),
      lengths: cleanEach(directives.lengths, (text) => singleLine(text)),
    }
  }
  if (key.endsWith('.defaults') || PATH_SETS.has(key)) return value
  return typeof value === 'string' ? singleLine(value) : value
}

// Whether a cleaned set equals its built-in in the config being saved; a model
// id is compared trimmed and case-insensitive. A role's thinking equals its
// built-in when it is empty or the default for the model the role selects; under
// a model with no row it is kept as chosen, for when a listed row returns.
export function equalsBuiltIn(key: string, cleaned: unknown, builtIn: unknown, config: AppConfig): boolean {
  if (MODEL_ID_SETS.has(key)) return (cleaned as string).toLowerCase() === (builtIn as string).toLowerCase()
  const thinking = THINKING_SETS.get(key)
  if (thinking) {
    const row = textRowFor(thinking.provider, config[thinking.provider][thinking.role.id])
    return cleaned === builtIn || (row !== undefined && cleaned === row.defaultThinking)
  }
  return valuesEqual(cleaned, builtIn)
}
