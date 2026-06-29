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

// Every env var the store may consult, cleared per test so a host that happens
// to set one doesn't mask the stored-value assertions.
const PROVIDER_ENV = [
  'GEMINI_API_KEY',
  'GEMINI_TEXT_API_KEY',
  'GEMINI_IMAGEN_API_KEY',
  'GEMINI_NANOBANANA_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_TEXT_API_KEY',
  'OPENAI_IMAGE_API_KEY',
  'XAI_API_KEY',
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

  it('stores the key in its OWN api-keys.json, under a keys container, never in config.json', () => {
    setStoredApiKey('openai.image', 'sk-stored')

    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    const configPath = path.join(tmpRoot, 'config.json')

    expect(fs.existsSync(secretsPath)).toBe(true)
    if (fs.existsSync(configPath)) {
      expect(fs.readFileSync(configPath, 'utf-8')).not.toContain('sk-stored')
    }
    const onDisk = fs.readFileSync(secretsPath, 'utf-8')
    expect(onDisk).not.toContain('sk-stored') // obfuscated at rest
    expect(JSON.parse(onDisk)).toHaveProperty(['keys', 'openai.image'])
    expect(getStoredApiKey('openai.image')).toBe('sk-stored')
  })

  it('resolves the environment value first, over any stored value', () => {
    setStoredApiKey('gemini.text', 'stored-gemini')
    process.env['GEMINI_TEXT_API_KEY'] = 'env-gemini'

    expect(resolveApiKey('gemini.text')).toBe('env-gemini')
    expect(hasApiKey('gemini.text')).toBe(true)
    // The stored value the UI edits is unchanged by the env override.
    expect(getStoredApiKey('gemini.text')).toBe('stored-gemini')
  })

  it('honors the provider-conventional fallback env var (segment chain)', () => {
    // GEMINI_TEXT_API_KEY is unset; the bare GEMINI_API_KEY still resolves
    // gemini.text via the most-to-least-specific env chain.
    process.env['GEMINI_API_KEY'] = 'conventional-gemini'
    expect(resolveApiKey('gemini.text')).toBe('conventional-gemini')
  })

  it('derives a single-segment vendor key from its bare env var', () => {
    process.env['XAI_API_KEY'] = 'env-xai'
    expect(resolveApiKey('xai')).toBe('env-xai')
  })

  it('falls back to the stored value when no env var is set, and trims it', () => {
    setStoredApiKey('bfl', '  stored-bfl  ')
    expect(resolveApiKey('bfl')).toBe('stored-bfl')
    expect(hasApiKey('bfl')).toBe(true)
  })

  it('treats an untagged stored value as plaintext', () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.mkdirSync(tmpRoot, { recursive: true })
    fs.writeFileSync(secretsPath, JSON.stringify({ keys: { xai: 'sk-pasted-raw' } }))
    expect(resolveApiKey('xai')).toBe('sk-pasted-raw')
  })

  it('returns empty when neither env nor stored value exists', () => {
    expect(resolveApiKey('xai')).toBe('')
    expect(hasApiKey('xai')).toBe(false)
  })

  it('clears the stored key when set to an empty value', () => {
    setStoredApiKey('gemini.imagen', 'temp')
    expect(getStoredApiKey('gemini.imagen')).toBe('temp')
    setStoredApiKey('gemini.imagen', '')
    expect(getStoredApiKey('gemini.imagen')).toBe('')
  })

  it('moves a corrupt secrets file aside and resolves to empty instead of throwing', () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.mkdirSync(tmpRoot, { recursive: true })
    fs.writeFileSync(secretsPath, 'not json at all')

    expect(resolveApiKey('xai')).toBe('')
    const entries = fs.readdirSync(tmpRoot)
    expect(entries.some((e) => e.startsWith('api-keys.json.') && e.endsWith('.invalid'))).toBe(true)
    expect(entries).not.toContain('api-keys.json')
  })

  it.runIf(isPosix)('writes api-keys.json with 0600 permissions on POSIX', () => {
    setStoredApiKey('openai.image', 'sk-stored')
    const mode = fs.statSync(path.join(tmpRoot, 'api-keys.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
