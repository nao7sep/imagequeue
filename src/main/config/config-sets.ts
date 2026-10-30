import type { AppConfig, BrainstormConfig } from './types'
import type { TextAIBackendId } from '../../shared/types'
import { createDefaultConfig } from './defaults'
import { isLanguage } from '../../shared/i18n/languages'
import { isTimeZone } from '../../shared/time-zone'
import { AI_ROLES, TEXT_PROVIDERS, textRowFor } from '../../shared/ai-models'
import { multiline, singleLine } from '../../shared/textCleanup'
import { valuesEqual } from '../settings-changes'
import { BRAINSTORM_LIMITS } from '../../shared/brainstorm-config'
import { AUTO_PREVIEW_SECONDS_RULE, CONCURRENCY_RULES, DRAW_THINGS_DIMENSION_RULE, DRAW_THINGS_GUIDANCE_RULE, DRAW_THINGS_STEPS_RULE, meetsNumberRule, type NumberRule } from '../../shared/number-field'

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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
    for (const [key, value] of Object.entries(backend)) sets[`image_backends.${id}.${key}`] = value
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
  for (const part of key.split('.')) value = isObject(value) && Object.hasOwn(value, part) ? value[part] : undefined
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
  return readPath(config, key)
}

export function applyConfigSet(config: AppConfig, key: string, value: unknown): void {
  writePath(config as unknown as Record<string, unknown>, key, value)
}

// The ranges the app's own code requires.
// The elaboration counts take the whole numbers Elaboration Settings accepts,
// so a hand-edited file or another caller cannot exceed them either.
const BRAINSTORM_LIMIT_SETS = new Map<string, { min: number; max: number }>(
  Object.entries(BRAINSTORM_LIMITS).map(([name, limits]) => [`brainstorm.${name}`, limits]))

// Settings' number fields accept the same rules, so a value they let through
// is never refused here.
const NUMBER_FIELD_SETS = new Map<string, NumberRule>([
  ['general.auto_preview_idle_seconds', AUTO_PREVIEW_SECONDS_RULE],
  ...Object.entries(CONCURRENCY_RULES).map(([backend, rule]) => [`image_backends.${backend}.concurrency`, rule] as const),
  ['image_backends.drawthings.default_params.fallback_width', DRAW_THINGS_DIMENSION_RULE],
  ['image_backends.drawthings.default_params.fallback_height', DRAW_THINGS_DIMENSION_RULE],
  ['image_backends.drawthings.default_params.fallback_steps', DRAW_THINGS_STEPS_RULE],
  ['image_backends.drawthings.default_params.fallback_guidance', DRAW_THINGS_GUIDANCE_RULE],
])

function meetsAppLimits(key: string, value: number): boolean {
  const limits = BRAINSTORM_LIMIT_SETS.get(key)
  if (limits) return Number.isInteger(value) && value >= limits.min && value <= limits.max
  const rule = NUMBER_FIELD_SETS.get(key)
  if (rule) return meetsNumberRule(value, rule)
  // An <audio> volume outside 0–1 throws.
  if (key === 'notifications.volume') return value >= 0 && value <= 1
  if (key.endsWith('.timeout_ms')) return value > 0
  return true
}

// Shape and the app's own limits: provider limits and current model support
// belong to the feature.
export function hasSetShape(value: unknown, builtIn: unknown, key = ''): boolean {
  if (key === 'general.theme') return ['system', 'light', 'dark'].includes(String(value))
  if (key === 'general.language') return value === 'system' || isLanguage(value)
  if (key === 'general.time_zone') return value === 'system' || isTimeZone(value)
  if (key === 'provider') return value === 'gemini' || value === 'openai'
  if (builtIn === null) return value === null || (typeof value === 'number' && Number.isFinite(value))
  if (Array.isArray(builtIn)) return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
  if (isObject(builtIn)) {
    return isObject(value) && Object.entries(builtIn).every(([member, expected]) => hasSetShape(value[member], expected, `${key}.${member}`))
  }
  return typeof value === typeof builtIn && (typeof value !== 'number' || (Number.isFinite(value) && meetsAppLimits(key, value)))
}

const MODEL_ID_SETS = new Set<string>(TEXT_PROVIDERS.flatMap((provider) => AI_ROLES.map((role) => `${provider}.${role.id}`)))
const THINKING_SETS = new Map<string, { provider: TextAIBackendId; role: (typeof AI_ROLES)[number] }>(
  TEXT_PROVIDERS.flatMap((provider) => AI_ROLES.map((role) => [`${provider}.thinking.${role.id}`, { provider, role }] as const)))
// Filesystem paths are identity values, stored and compared exactly as given.
const PATH_SETS = new Set<string>([
  'general.export_dir', 'notifications.success_file', 'notifications.failure_file', 'image_backends.drawthings.models_dir',
])

function cleanEach<T extends object>(record: T, declared: T, clean: (text: string) => string): T {
  return { ...record, ...Object.fromEntries(Object.keys(declared).map((key) => [key, clean((record as Record<string, string>)[key])])) }
}

// A set's text as it is compared and stored (text-cleanup-conventions): bodies
// multiline, scalars single-line. Paths are stored as given.
// Expects a value of the set's shape.
export function cleanConfigSet(key: string, value: unknown): unknown {
  if (key === 'prompts.slug') return multiline(value as string)
  if (key === 'brainstorm.templates') {
    return cleanEach(value as BrainstormConfig['templates'], createDefaultConfig().brainstorm.templates, multiline)
  }
  if (key === 'brainstorm.format_directives') {
    const directives = value as BrainstormConfig['format_directives']
    return {
      ...directives,
      formats: cleanEach(directives.formats, createDefaultConfig().brainstorm.format_directives.formats, singleLine),
      lengths: cleanEach(directives.lengths, createDefaultConfig().brainstorm.format_directives.lengths, singleLine),
    }
  }
  if (PATH_SETS.has(key)) return value
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
