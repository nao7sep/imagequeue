import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  notifications: { success_file: '', failure_file: '' },
  protocolHandler: null as ((request: Request) => Promise<Response>) | null,
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  screen: {},
  protocol: { handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => { mocks.protocolHandler = handler } },
  net: { fetch: async (url: string) => new Response(await fs.promises.readFile(fileURLToPath(url))) },
}))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/config', () => ({
  loadConfig: () => ({ notifications: mocks.notifications }),
}))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: () => ({ t: (key: string) => key }) }))

const { registerNotificationIpc } = await import('../../src/main/notification')
const { registerAudioProtocol } = await import('../../src/main/audio-protocol')
registerNotificationIpc()
registerAudioProtocol()

function loadAudioFile(filePath: string): Promise<string | null> {
  return Promise.resolve(mocks.handlers.get('notification:loadAudioFile')!({}, filePath) as string | null)
}
function serve(url: string): Promise<Response> {
  return mocks.protocolHandler!(new Request(url))
}

// A sound path the user typed is resolved before it is compared or read, so a
// home-relative setting plays whatever directory the app was launched from.
describe('notification:loadAudioFile', () => {
  let soundDir: string

  beforeEach(() => {
    mocks.notifications.success_file = ''
    mocks.notifications.failure_file = ''
    soundDir = fs.mkdtempSync(path.join(os.homedir(), 'sounds-'))
    fs.writeFileSync(path.join(soundDir, 'done.wav'), 'RIFF')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(soundDir, { recursive: true, force: true })
  })

  it('reads a configured home-relative path', async () => {
    const configured = path.join('~', path.basename(soundDir), 'done.wav')
    mocks.notifications.success_file = configured
    await expect(loadAudioFile(configured)).resolves.toBe('iq-audio://sound/success')
  })

  it('reads a configured path relative to the home directory', async () => {
    const configured = path.join(path.basename(soundDir), 'done.wav')
    mocks.notifications.failure_file = configured
    await expect(loadAudioFile(configured)).resolves.toBe('iq-audio://sound/failure')
  })

  it('reads literal selected names even when their variables exist in the environment', async () => {
    vi.stubEnv('IMAGEQUEUE_SOUND_PATH', 'expanded')
    const selected = path.join(soundDir, '$IMAGEQUEUE_SOUND_PATH%IMAGEQUEUE_SOUND_PATH%.wav ')
    fs.writeFileSync(selected, 'literal audio')
    mocks.notifications.success_file = selected
    await expect(loadAudioFile(selected)).resolves.toBe('iq-audio://sound/success')
    await expect(loadAudioFile(selected.replaceAll('$IMAGEQUEUE_SOUND_PATH', 'expanded'))).resolves.toBeNull()
    expect(await (await serve('iq-audio://sound/success')).text()).toBe('literal audio')
  })

  it('still refuses a path the user did not configure', async () => {
    mocks.notifications.success_file = path.join('~', path.basename(soundDir), 'done.wav')
    await expect(loadAudioFile(path.join(soundDir, 'other.wav'))).resolves.toBeNull()
  })

  it('serves only the currently configured file for each sound', async () => {
    const file = path.join(soundDir, 'done.wav')
    mocks.notifications.success_file = file
    expect(await (await serve('iq-audio://sound/success')).text()).toBe('RIFF')
    fs.writeFileSync(file, 'replaced')
    expect(await (await serve('iq-audio://sound/success')).text()).toBe('replaced')
    expect((await serve('iq-audio://sound/failure')).status).toBe(404)
    expect((await serve('iq-audio://sound/other')).status).toBe(404)
    mocks.notifications.success_file = path.join(soundDir, 'missing.wav')
    expect((await serve('iq-audio://sound/success')).status).toBe(404)
  })
})
