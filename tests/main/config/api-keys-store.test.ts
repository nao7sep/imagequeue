import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let resolveApiKey: typeof import('../../../src/main/config/api-keys-store').resolveApiKey
let refreshApiKeys: typeof import('../../../src/main/config/api-keys-store').refreshApiKeys
let hasApiKey: typeof import('../../../src/main/config/api-keys-store').hasApiKey
let getStoredApiKey: typeof import('../../../src/main/config/api-keys-store').getStoredApiKey
let setStoredApiKey: typeof import('../../../src/main/config/api-keys-store').setStoredApiKey
let ApiKeysUnavailableError: typeof import('../../../src/main/config/api-keys-store').ApiKeysUnavailableError

import { FORMAT_VERSIONS } from '../../../src/main/store-format'

const notices = vi.hoisted(() => ({ raised: [] as unknown[] }))
vi.mock('../../../src/main/app-notices', () => ({
  raiseAppNotice: (notice: unknown) => { notices.raised.push(notice) },
}))

const ENV_VAR = 'IMAGEQUEUE_DATA_DIR'
const isPosix = process.platform !== 'win32'

// Every env var the store may consult, cleared per test so a host that happens
// to set one doesn't mask the stored-value assertions.
const PROVIDER_ENV = [
  'GEMINI_API_KEY',
  'GEMINI_TEXT_API_KEY',
  'GEMINI_NANOBANANA_API_KEY',
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

  beforeEach(async () => {
    vi.resetModules()
    ;({ resolveApiKey, refreshApiKeys, hasApiKey, getStoredApiKey, setStoredApiKey, ApiKeysUnavailableError } = await import('../../../src/main/config/api-keys-store'))
    notices.raised.length = 0
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

  it('stores the key in its OWN api-keys.json, under a keys container, never in config.json', async () => {
    await setStoredApiKey('openai.image', 'sk-stored')

    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    const configPath = path.join(tmpRoot, 'config.json')

    expect(fs.existsSync(secretsPath)).toBe(true)
    if (fs.existsSync(configPath)) {
      expect(fs.readFileSync(configPath, 'utf-8')).not.toContain('sk-stored')
    }
    const onDisk = fs.readFileSync(secretsPath, 'utf-8')
    expect(onDisk).not.toContain('sk-stored') // obfuscated at rest
    expect(JSON.parse(onDisk)).toHaveProperty(['keys', 'openai.image'])
    await refreshApiKeys()
    expect(getStoredApiKey('openai.image')).toBe('sk-stored')
  })

  it('resolves the environment value first, over any stored value', async () => {
    await setStoredApiKey('gemini.text', 'stored-gemini')
    process.env['GEMINI_TEXT_API_KEY'] = 'env-gemini'

    await refreshApiKeys()
    expect(resolveApiKey('gemini.text')).toBe('env-gemini')
    expect(hasApiKey('gemini.text')).toBe(true)
    // The stored value the UI edits is unchanged by the env override.
    expect(getStoredApiKey('gemini.text')).toBe('stored-gemini')
  })

  it('does NOT fall back to a bare provider key — resolution is exact-only', async () => {
    // Every openai/gemini key here is purpose-scoped, so a bare `gemini` (a stored
    // one, or an ambient GEMINI_API_KEY exported for another tool) is never a key
    // the user set in this app. Resolving a scoped id from it would light up a
    // billed backend nobody configured here — the surprise this prevents. Both the
    // bare env var and a bare stored key are ignored for gemini.text.
    process.env['GEMINI_API_KEY'] = 'conventional-gemini'
    fs.writeFileSync(
      path.join(tmpRoot, 'api-keys.json'),
      JSON.stringify({ formatVersion: 1, keys: { gemini: 'sk-bare-stored' } })
    )
    await refreshApiKeys()
    expect(resolveApiKey('gemini.text')).toBe('')
    expect(hasApiKey('gemini.text')).toBe(false)

    // The exact-id env var still resolves it, as before.
    process.env['GEMINI_TEXT_API_KEY'] = 'env-scoped'
    await refreshApiKeys()
    expect(resolveApiKey('gemini.text')).toBe('env-scoped')
  })

  it('derives a single-segment vendor key from its bare env var', async () => {
    process.env['XAI_API_KEY'] = 'env-xai'
    await refreshApiKeys()
    expect(resolveApiKey('xai')).toBe('env-xai')
  })

  it('falls back to the stored value when no env var is set, and trims it', async () => {
    await setStoredApiKey('bfl', '  stored-bfl  ')
    await refreshApiKeys()
    expect(resolveApiKey('bfl')).toBe('stored-bfl')
    expect(hasApiKey('bfl')).toBe(true)
  })

  it('treats an untagged stored value as plaintext', async () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.mkdirSync(tmpRoot, { recursive: true })
    fs.writeFileSync(secretsPath, JSON.stringify({ formatVersion: 1, keys: { xai: 'sk-pasted-raw' } }))
    await refreshApiKeys()
    expect(resolveApiKey('xai')).toBe('sk-pasted-raw')
  })

  it('returns empty when neither env nor stored value exists', async () => {
    await refreshApiKeys()
    expect(resolveApiKey('xai')).toBe('')
    expect(hasApiKey('xai')).toBe(false)
  })

  it('clears the stored key when set to an empty value', async () => {
    await setStoredApiKey('gemini.nanobanana', 'temp')
    expect(getStoredApiKey('gemini.nanobanana')).toBe('temp')
    await setStoredApiKey('gemini.nanobanana', '')
    expect(getStoredApiKey('gemini.nanobanana')).toBe('')
  })

  it('treats a malformed obf: stored value as absent and warns once, naming the key id', async () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.mkdirSync(tmpRoot, { recursive: true })
    // Node's lenient base64 decoder would otherwise turn a payload like this
    // (invalid characters, non-canonical shape) into non-empty garbage that
    // gets sent to the provider as an API key.
    fs.writeFileSync(secretsPath, JSON.stringify({ formatVersion: 1, keys: { xai: 'obf:not-valid-base64!!' } }))

    const errorSpy = vi.spyOn(await import('../../../src/main/logger'), 'log').mockImplementation(() => {})
    try {
      await refreshApiKeys()
    expect(resolveApiKey('xai')).toBe('')
      expect(hasApiKey('xai')).toBe(false)
      expect(getStoredApiKey('xai')).toBe('')

      const warnedAboutXai = errorSpy.mock.calls.some(
        (call) =>
          call[1].includes('malformed') && call[2]?.keyId === 'xai'
      )
      expect(warnedAboutXai).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('resolves a validly-encoded stored key (round trip through encode/decode)', async () => {
    await setStoredApiKey('xai', 'sk-round-trip-value')
    expect(getStoredApiKey('xai')).toBe('sk-round-trip-value')
    await refreshApiKeys()
    expect(resolveApiKey('xai')).toBe('sk-round-trip-value')
  })

  // Reading never moves or rewrites the file: whatever is wrong with it, its
  // keys are unavailable, a save is refused, and its bytes stay as they were.
  it.each([
    ['not JSON', 'not json at all'],
    ['the wrong root', JSON.stringify({ formatVersion: 1, xai: 'do-not-overwrite-these-bytes' })],
    ['a keys container of the wrong shape', JSON.stringify({ formatVersion: 1, keys: ['xai', 'not-an-object-container'] })],
    ['a format version that is not a positive integer', JSON.stringify({ formatVersion: 'one', keys: { xai: 'sk-kept' } })],
  ])('leaves a file holding %s in place, reads no keys, and refuses a save', async (_state, original) => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.writeFileSync(secretsPath, original)

    await refreshApiKeys()
    expect(resolveApiKey('xai')).toBe('')
    expect(getStoredApiKey('xai')).toBe('')
    await expect(setStoredApiKey('openai.image', 'must-not-land')).rejects.toThrow(ApiKeysUnavailableError)

    expect(fs.readFileSync(secretsPath, 'utf8')).toBe(original)
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.invalid') || name.endsWith('.tmp'))).toEqual([])
  })

  it.runIf(isPosix && process.getuid?.() !== 0)('leaves a file it cannot read in place, reads no keys, and refuses a save', async () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    await setStoredApiKey('xai', 'sk-stored')
    const original = fs.readFileSync(secretsPath)
    fs.chmodSync(secretsPath, 0o000)
    try {
      await refreshApiKeys()
    expect(resolveApiKey('xai')).toBe('')
      expect(hasApiKey('xai')).toBe(false)
      await expect(setStoredApiKey('xai', 'sk-other')).rejects.toThrow(ApiKeysUnavailableError)
    } finally {
      fs.chmodSync(secretsPath, 0o600)
    }
    expect(fs.readFileSync(secretsPath)).toEqual(original)
    expect(fs.readdirSync(tmpRoot).filter((name) => name !== 'api-keys.json')).toEqual([])
  })

  it('writes back an entry it cannot use, and every other key the file holds, when saving another key', async () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.writeFileSync(secretsPath, JSON.stringify({ formatVersion: 1, later: { kept: true }, keys: { xai: 42, 'Bad Id': 'sk-odd' } }))

    await setStoredApiKey('openai.image', 'sk-new')

    const onDisk = JSON.parse(fs.readFileSync(secretsPath, 'utf8'))
    expect(onDisk.later).toEqual({ kept: true })
    expect(onDisk.keys.xai).toBe(42)
    expect(onDisk.keys['Bad Id']).toBe('sk-odd')
    expect(getStoredApiKey('openai.image')).toBe('sk-new')
  })

  it('resolves a key stored under an id differing only in case, and saves it under the exact id', async () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.writeFileSync(secretsPath, JSON.stringify({ formatVersion: 1, keys: { 'OPENAI.IMAGE': 'sk-hand-edited' } }))
    await refreshApiKeys()
    expect(resolveApiKey('openai.image')).toBe('sk-hand-edited')
    await setStoredApiKey('openai.image', 'sk-new')
    expect(Object.keys(JSON.parse(fs.readFileSync(secretsPath, 'utf8')).keys)).toEqual(['openai.image'])
  })

  it.runIf(isPosix)('writes api-keys.json with 0600 permissions on POSIX', async () => {
    await setStoredApiKey('openai.image', 'sk-stored')
    const mode = fs.statSync(path.join(tmpRoot, 'api-keys.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('removes private staging after publication fails and preserves the primary error', async () => {
    await setStoredApiKey('openai.image', 'original')
    const failure = new Error('publication unavailable')
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(() => { throw failure })
    try {
      await expect(setStoredApiKey('openai.image', 'replacement')).rejects.toThrow(failure)
      expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
      expect(getStoredApiKey('openai.image')).toBe('original')
    } finally { rename.mockRestore() }
  })

  it.runIf(isPosix)('does not tighten permissions of a newer secret file', async () => {
    const file = path.join(tmpRoot, 'api-keys.json')
    fs.writeFileSync(file, JSON.stringify({ formatVersion: 2, keys: {} }), { mode: 0o644 })
    fs.chmodSync(file, 0o644)
    expect(getStoredApiKey('openai.image')).toBe('')
    expect(fs.statSync(file).mode & 0o777).toBe(0o644)
  })

  it.runIf(isPosix)('re-tightens a secrets file widened mid-session, not only once per session', async () => {
    await setStoredApiKey('openai.image', 'sk-stored')
    const secretsPath = path.join(tmpRoot, 'api-keys.json')

    // Widen it (another process, a careless chmod) and access again — the
    // chmod must fire on THIS access rather than being deferred to restart.
    fs.chmodSync(secretsPath, 0o644)
    expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o644)
    await refreshApiKeys()
    expect(hasApiKey('openai.image')).toBe(true)
    expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600)

    // Widen it a SECOND time in the same process/session. If the chmod were
    // still gated behind the once-per-session warned flag, this access would
    // leave it loose; it must not.
    fs.chmodSync(secretsPath, 0o644)
    await refreshApiKeys()
    expect(hasApiKey('openai.image')).toBe(true)
    expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600)
  })

  it('writes through a temp file named `<stem>-<nanoid>.tmp` in the same directory as the target', async () => {
    const spy = vi.spyOn(fs.promises, 'open')
    await setStoredApiKey('openai.image', 'sk-stored')

    const tempCall = spy.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('api-keys-')
    )
    expect(tempCall).toBeDefined()
    const tempPath = tempCall![0] as string
    expect(path.dirname(tempPath)).toBe(tmpRoot)
    expect(path.basename(tempPath)).toMatch(/^api-keys-[A-Za-z0-9_-]+\.tmp$/)
    spy.mockRestore()
  })

  it('leaves the file untouched when saving the key it already holds', async () => {
    await setStoredApiKey('openai.image', 'sk-stored')
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    const old = new Date('2001-02-03T04:05:06.000Z')
    fs.utimesSync(secretsPath, old, old)
    const rename = vi.spyOn(fs.promises, 'rename')
    await setStoredApiKey('openai.image', 'sk-stored')
    expect(rename).not.toHaveBeenCalled()
    rename.mockRestore()
    expect(fs.statSync(secretsPath).mtimeMs).toBe(old.getTime())
  })
  describe('format version', () => {
    const secretsPath = () => path.join(tmpRoot, 'api-keys.json')

    it('reads a file with no format version as current, and marks it at the next save', async () => {
      fs.writeFileSync(secretsPath(), JSON.stringify({ keys: { xai: 'sk-pasted-raw' } }))
      expect(getStoredApiKey('xai')).toBe('sk-pasted-raw')
      await setStoredApiKey('openai.image', 'sk-stored')
      const onDisk = JSON.parse(fs.readFileSync(secretsPath(), 'utf8'))
      expect(onDisk.formatVersion).toBe(FORMAT_VERSIONS.apiKeys)
      expect(onDisk.keys.xai).toBe('sk-pasted-raw')
    })

    it('writes its format version first and reads it back', async () => {
      await setStoredApiKey('openai.image', 'sk-stored')
      expect(Object.entries(JSON.parse(fs.readFileSync(secretsPath(), 'utf8')))[0]).toEqual(['formatVersion', FORMAT_VERSIONS.apiKeys])
      await refreshApiKeys()
    expect(getStoredApiKey('openai.image')).toBe('sk-stored')
    })

    it('reads a file from a newer version as no keys, refuses a change, and leaves its bytes as they were', async () => {
      await setStoredApiKey('openai.image', 'sk-stored')
      const marked = JSON.parse(fs.readFileSync(secretsPath(), 'utf8'))
      const bytes = JSON.stringify({ ...marked, formatVersion: FORMAT_VERSIONS.apiKeys + 1 })
      fs.writeFileSync(secretsPath(), bytes)

      await refreshApiKeys()
    expect(resolveApiKey('openai.image')).toBe('')
      expect(getStoredApiKey('openai.image')).toBe('')
      await expect(setStoredApiKey('openai.image', 'sk-other')).rejects.toThrow(ApiKeysUnavailableError)
      expect(fs.readFileSync(secretsPath(), 'utf8')).toBe(bytes)
      expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.invalid'))).toEqual([])
    })
  })
})

describe('api-keys-store notices', () => {
  let tmpRoot: string
  beforeEach(async () => {
    vi.resetModules()
    ;({ resolveApiKey, refreshApiKeys, hasApiKey, getStoredApiKey, setStoredApiKey, ApiKeysUnavailableError } = await import('../../../src/main/config/api-keys-store'))
    notices.raised.length = 0
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-keys-notice-'))
    vi.stubEnv(ENV_VAR, tmpRoot)
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('names a file it cannot use once per launch, however often its keys are looked up', async () => {
    const secretsPath = path.join(tmpRoot, 'api-keys.json')
    fs.writeFileSync(secretsPath, 'not json at all')
    const store = await import('../../../src/main/config/api-keys-store')
    store.resolveApiKey('xai')
    store.hasApiKey('openai.image')
    store.getStoredApiKey('gemini.text')
    expect(notices.raised).toHaveLength(1)
    expect(JSON.stringify(notices.raised[0])).toContain(secretsPath)
  })

  it('names the file again with each refused save', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'api-keys.json'), 'not json at all')
    const store = await import('../../../src/main/config/api-keys-store')
    store.resolveApiKey('xai')
    await expect(store.setStoredApiKey('xai', 'sk-new')).rejects.toThrow(store.ApiKeysUnavailableError)
    expect(notices.raised).toHaveLength(2)
  })

  it('raises nothing for a file that is absent or usable', async () => {
    const store = await import('../../../src/main/config/api-keys-store')
    store.resolveApiKey('xai')
    store.setStoredApiKey('xai', 'sk-new')
    store.resolveApiKey('xai')
    expect(notices.raised).toEqual([])
  })
})
