import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveStorageRoot } from '../../src/main/config/storage-root'

// The default test run must never resolve or create the developer's real
// ~/.imagequeue, even in a test that leaves IMAGEQUEUE_DATA_DIR unset.
describe('the test environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves the default storage root inside a throwaway home', () => {
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', '')
    const root = resolveStorageRoot()
    expect(path.dirname(root)).toBe(os.homedir())
    expect(path.basename(path.dirname(root))).toMatch(/^imagequeue-test-home-/)
    expect(path.dirname(os.homedir())).toBe(path.resolve(os.tmpdir()))
  })

  it('starts the data-root override inside the throwaway home, whatever the shell exported', () => {
    const root = resolveStorageRoot()
    expect(path.dirname(root)).toBe(os.homedir())
    expect(process.env.IMAGEQUEUE_DATA_DIR).toBe(root)
  })
})
