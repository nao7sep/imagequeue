import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The image scheme serves files from the sessions folder only: a request names a
// session and a base name, and neither may step outside it.

const dirs = vi.hoisted(() => ({ sessions: '' }))
vi.mock('electron', () => ({ net: {}, protocol: {} }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (e: unknown) => e }))
vi.mock('../../src/main/session', () => ({
  getSessionDir: () => path.join(dirs.sessions, 'current-session'),
  resolveSessionDir: (id: string) => {
    if (!id || path.basename(id) !== id) throw new Error('Invalid session id.')
    return path.join(dirs.sessions, id)
  },
}))

const { resolveImageRequest } = await import('../../src/main/image-protocol')

beforeAll(() => {
  dirs.sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-image-'))
  fs.mkdirSync(path.join(dirs.sessions, 'current-session'))
  fs.mkdirSync(path.join(dirs.sessions, 'old-session'))
  fs.writeFileSync(path.join(dirs.sessions, 'current-session', 'a.png'), 'x')
  fs.writeFileSync(path.join(dirs.sessions, 'old-session', 'b.webp'), 'x')
  fs.writeFileSync(path.join(dirs.sessions, 'secret.png'), 'x')
})

afterAll(() => {
  fs.rmSync(dirs.sessions, { recursive: true, force: true })
})

describe('resolveImageRequest', () => {
  it('finds an image of the active session and of a listed session, whatever its extension', async () => {
    expect(await resolveImageRequest('iq-image://sessions/current/a')).toBe(path.join(dirs.sessions, 'current-session', 'a.png'))
    expect(await resolveImageRequest('iq-image://sessions/session/old-session/b')).toBe(path.join(dirs.sessions, 'old-session', 'b.webp'))
  })

  it('serves nothing for a missing image or a name that leaves the output tree', async () => {
    expect(await resolveImageRequest('iq-image://sessions/current/missing')).toBeNull()
    expect(await resolveImageRequest('iq-image://sessions/current/..%2Fsecret')).toBeNull()
    expect(await resolveImageRequest('iq-image://sessions/session/..%2F..%2Fetc/passwd')).toBeNull()
    expect(await resolveImageRequest('iq-image://sessions/session/..%2Fold-session/b')).toBeNull()
  })
})
