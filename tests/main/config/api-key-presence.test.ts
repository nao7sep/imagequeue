import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasApiKey, setStoredApiKey, getStoredApiKey } from '../../../src/main/config/api-keys-store'

// The split that caused the env-only-key bug, pinned at its source: what the
// settings form reads (the STORED value, deliberately blind to the environment)
// and what "is this backend usable" means (resolution, environment first) are
// different questions. settings:getApiKeyPresence answers the second; these
// tests hold the two apart so a future refactor cannot quietly merge them.

const ENV_VAR = 'IMAGEQUEUE_HOME'
const KEY_ENV = 'OPENAI_IMAGE_API_KEY'

describe('api key presence vs stored value', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]
  const originalKey = process.env[KEY_ENV]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-presence-'))
    process.env[ENV_VAR] = tmpRoot
    delete process.env[KEY_ENV]
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    if (originalKey === undefined) delete process.env[KEY_ENV]
    else process.env[KEY_ENV] = originalKey
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('reports absent when neither a stored nor an environment key exists', () => {
    expect(hasApiKey('openai.image')).toBe(false)
    expect(getStoredApiKey('openai.image')).toBe('')
  })

  // The bug, at its origin: presence must see the environment even though the
  // stored value the UI is handed stays empty.
  it('reports PRESENT for an environment-only key, while the stored value stays empty', () => {
    process.env[KEY_ENV] = 'env-supplied-key'
    expect(hasApiKey('openai.image')).toBe(true)
    expect(getStoredApiKey('openai.image')).toBe('')
  })

  it('reports present for a stored key with no environment value', () => {
    setStoredApiKey('openai.image', 'stored-key')
    expect(hasApiKey('openai.image')).toBe(true)
    expect(getStoredApiKey('openai.image')).toBe('stored-key')
  })

  it('keeps ids independent, so one backend’s key never implies another’s', () => {
    process.env[KEY_ENV] = 'env-supplied-key'
    expect(hasApiKey('openai.image')).toBe(true)
    expect(hasApiKey('bfl')).toBe(false)
    // openai.image and openai.text are separate purpose-scoped ids: an image key
    // must not light up the text backend (api-key-storage's exact-only rule).
    expect(hasApiKey('openai.text')).toBe(false)
  })
})
