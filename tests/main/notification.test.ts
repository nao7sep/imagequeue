import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  notifications: { success_file: '', failure_file: '' },
}))

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/config', () => ({
  loadConfig: () => ({ notifications: mocks.notifications }),
  getDataDir: () => path.join(os.homedir(), '.imagequeue'),
}))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: vi.fn() }))

const { registerNotificationIpc } = await import('../../src/main/notification')
registerNotificationIpc()

function loadAudioFile(filePath: string): Promise<string | null> {
  return mocks.handlers.get('notification:loadAudioFile')!({ sender: {} }, filePath) as Promise<string | null>
}

// A sound path the user typed is resolved before it is compared or read, so a
// home-relative setting plays whatever directory the app was launched from.
describe('notification:loadAudioFile', () => {
  let soundDir: string

  beforeEach(() => {
    soundDir = fs.mkdtempSync(path.join(os.homedir(), 'sounds-'))
    fs.writeFileSync(path.join(soundDir, 'done.wav'), 'RIFF')
  })

  afterEach(() => {
    fs.rmSync(soundDir, { recursive: true, force: true })
  })

  it('reads a configured home-relative path', async () => {
    const configured = path.join('~', path.basename(soundDir), 'done.wav')
    mocks.notifications.success_file = configured
    await expect(loadAudioFile(configured)).resolves.toBe(`data:audio/wav;base64,${Buffer.from('RIFF').toString('base64')}`)
  })

  it('reads a configured path relative to the home directory', async () => {
    const configured = path.join(path.basename(soundDir), 'done.wav')
    mocks.notifications.success_file = configured
    await expect(loadAudioFile(configured)).resolves.toBe(`data:audio/wav;base64,${Buffer.from('RIFF').toString('base64')}`)
  })

  it('still refuses a path the user did not configure', async () => {
    mocks.notifications.success_file = path.join('~', path.basename(soundDir), 'done.wav')
    await expect(loadAudioFile(path.join(soundDir, 'other.wav'))).resolves.toBeNull()
  })
})
