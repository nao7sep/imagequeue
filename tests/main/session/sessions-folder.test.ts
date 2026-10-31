import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('the sessions folder', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-sessions-folder-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('starts each launch\'s session in the sessions folder', async () => {
    const { initSession } = await import('../../../src/main/session/session')
    const current = (await initSession())
    expect(path.dirname(current)).toBe(path.join(root, 'sessions'))
  })
})
