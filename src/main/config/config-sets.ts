import type { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { isLanguage } from '../../shared/i18n/languages'

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
  sets.extraModelIds = config.extraModelIds
  for (const provider of ['gemini', 'openai'] as const) {
    for (const [key, value] of Object.entries(config[provider])) sets[`${provider}.${key}`] = value
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
  sets.brainstorm = config.brainstorm
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

// Shape only: provider limits and current model support belong to the feature.
export function hasSetShape(value: unknown, builtIn: unknown, key = ''): boolean {
  if (key === 'general.theme') return ['system', 'light', 'dark'].includes(String(value))
  if (key === 'general.language') return value === 'system' || isLanguage(value)
  if (key === 'provider') return value === 'gemini' || value === 'openai'
  if (key === 'extraModelIds') return isObject(value) && Object.entries(value).every(([provider, ids]) =>
    ['gemini', 'openai'].includes(provider) && Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
  if (key.endsWith('.defaults')) {
    if (!isObject(value) || typeof value.model !== 'string' || !isObject(value.default_params)) return false
    const expected = (builtIn as { default_params: Record<string, unknown> }).default_params
    const optional = key.includes('.nanobanana.') ? Object.keys(expected) : key.includes('.grok.') ? ['quality'] : []
    return Object.entries(expected).every(([member, shape]) =>
      (value.default_params as Record<string, unknown>)[member] === undefined && optional.includes(member)
        || hasSetShape((value.default_params as Record<string, unknown>)[member], shape))
      && Object.entries(value.default_params).every(([member, item]) =>
        member in expected ? hasSetShape(item, expected[member])
          : (member === 'steps' || member === 'guidance') && typeof item === 'number' && Number.isFinite(item))
  }
  if (builtIn === null) return value === null || (typeof value === 'number' && Number.isFinite(value))
  if (Array.isArray(builtIn)) return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
  if (isObject(builtIn)) {
    return isObject(value) && Object.entries(builtIn).every(([member, expected]) => hasSetShape(value[member], expected))
  }
  return typeof value === typeof builtIn && (typeof value !== 'number' || Number.isFinite(value))
}
