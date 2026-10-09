import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sessions moved from output/ to sessions/. A data root that still has only
// the old folder has it renamed once at launch, sessions and all.
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

  function stageOldSession(): string {
    const old = path.join(root, 'output', '20260101-000000-000-utc')
    fs.mkdirSync(old, { recursive: true })
    fs.writeFileSync(path.join(old, 'session.json'), '{"kept":true}')
    fs.writeFileSync(path.join(old, 'image.png'), 'image')
    return path.basename(old)
  }

  it('starts a new install with only the sessions folder', async () => {
    const { initSession } = await import('../../../src/main/session/session')
    const current = (await initSession())
    expect(path.dirname(current)).toBe(path.join(root, 'sessions'))
    expect(fs.existsSync(path.join(root, 'output'))).toBe(false)
  })

  it('renames an old output folder to sessions at launch, keeping every session in it', async () => {
    const id = stageOldSession()
    const { initSession, getSessionsDir } = await import('../../../src/main/session/session')
    await initSession()
    expect(fs.existsSync(path.join(root, 'output'))).toBe(false)
    expect(fs.readFileSync(path.join(getSessionsDir(), id, 'session.json'), 'utf8')).toBe('{"kept":true}')
    expect(fs.readFileSync(path.join(getSessionsDir(), id, 'image.png'), 'utf8')).toBe('image')
  })

  it('leaves an old output folder alone once a sessions folder exists', async () => {
    stageOldSession()
    fs.mkdirSync(path.join(root, 'sessions'))
    const { initSession } = await import('../../../src/main/session/session')
    await initSession()
    expect(fs.readdirSync(path.join(root, 'output'))).toEqual(['20260101-000000-000-utc'])
  })

  it('stops launch, leaving the old folder in place, when the rename fails', async () => {
    stageOldSession()
    const { initSession } = await import('../../../src/main/session/session')
    vi.spyOn(fs.promises, 'rename').mockImplementationOnce(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) })
    await expect(initSession()).rejects.toThrow('busy')
    expect(fs.existsSync(path.join(root, 'output', '20260101-000000-000-utc', 'session.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'sessions'))).toBe(false)
  })
})
