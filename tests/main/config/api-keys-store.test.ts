import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveApiKey,
  hasApiKey,
  getStoredApiKey,
  setStoredApiKey
} from '../../../src/main/config/api-keys-store'

const ENV_VAR = 'IMAGEQUEUE_HOME'
const isPosix = process.platform !== 'win32'

// Every env var the store consults, so a test environment that happens to set
// one of these doesn't mask the stored-value assertions.
const PROVIDER_ENV = [
  'IMAGEQUEUE_GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'IMAGEQUEUE_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'IMAGEQUEUE_OPENAI_IMAGE_API_KEY',
  'IMAGEQUEUE_IMAGEN_API_KEY',
  'IMAGEQUEUE_NANOBANANA_API_KEY',
  'IMAGEQUEUE_GROK_API_KEY',
  'XAI_API_KEY',
  'IMAGEQUEUE_FLUX_API_KEY',
  'BFL_API_KEY'
]

describe('api-keys-store', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]
  const savedEnv = new Map<string, string | undefined>()

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-keys-'))
    process.env[ENV_VAR] = tmpRoot
    for (const name of PROVIDER_ENV) {
      savedEnv.set(name, process.env[name])
      delete process.env[name]
    }
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    savedEnv.clear()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('stores the key in its OWN api-keys.json file, not in config.json', () => {
    setStoredApiKey('image.openai', 'sk-stored')

    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    const configPath = path.join(tmpRoot, 'config.json')

    expect(fs.existsSync(secretsPath)).toBe(true)
    // The raw key must not appear in config.json (which may or may not exist
    // here; this store never writes it there).
    if (fs.existsSync(configPath)) {
      expect(fs.readFileSync(configPath, 'utf-8')).not.toContain('sk-stored')
    }
    // The plaintext key is not sitting in the secrets file either (it is
    // base64+reversed), but it round-trips back out decoded.
    expect(fs.readFileSync(secretsPath, 'utf-8')).not.toContain('sk-stored')
    expect(getStoredApiKey('image.openai')).toBe('sk-stored')
  })

  it('resolves the environment value first, over any stored value', () => {
    setStoredApiKey('text_ai.gemini', 'stored-gemini')
    process.env['IMAGEQUEUE_GEMINI_API_KEY'] = 'env-gemini'

    expect(resolveApiKey('text_ai.gemini')).toBe('env-gemini')
    expect(hasApiKey('text_ai.gemini')).toBe(true)
    // The stored value the UI edits is unchanged by the env override.
    expect(getStoredApiKey('text_ai.gemini')).toBe('stored-gemini')
  })

  it('honors the provider-conventional fallback env var', () => {
    process.env['GEMINI_API_KEY'] = 'conventional-gemini'
    expect(resolveApiKey('text_ai.gemini')).toBe('conventional-gemini')
  })

  it('falls back to the stored value when no env var is set', () => {
    setStoredApiKey('image.flux', 'stored-flux')
    expect(resolveApiKey('image.flux')).toBe('stored-flux')
    expect(hasApiKey('image.flux')).toBe(true)
  })

  it('returns empty when neither env nor stored value exists', () => {
    expect(resolveApiKey('image.grok')).toBe('')
    expect(hasApiKey('image.grok')).toBe(false)
  })

  it('clears the stored key when set to an empty value', () => {
    setStoredApiKey('image.imagen', 'temp')
    expect(getStoredApiKey('image.imagen')).toBe('temp')
    setStoredApiKey('image.imagen', '')
    expect(getStoredApiKey('image.imagen')).toBe('')
  })

  it.runIf(isPosix)('writes api-keys.json with 0600 permissions on POSIX', () => {
    setStoredApiKey('image.openai', 'sk-stored')
    const mode = fs.statSync(path.join(tmpRoot, 'api-keys.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
