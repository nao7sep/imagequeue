import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  notifications: { success_file: '', failure_file: '' },
  root: '',
  showMessageBox: vi.fn(),
}))

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null }, screen: {}, dialog: { showMessageBox: mocks.showMessageBox } }))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/config', () => ({
  loadConfig: () => ({ notifications: mocks.notifications }),
  getDataDir: () => mocks.root,
}))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: () => ({ t: (key: string) => key }) }))

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
    mocks.showMessageBox.mockReset().mockResolvedValue({ response: 1 })
    mocks.notifications.success_file = ''
    mocks.notifications.failure_file = ''
    soundDir = fs.mkdtempSync(path.join(os.homedir(), 'sounds-'))
    mocks.root = soundDir
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

  it('reads literal selected names even when their variables exist in the environment', async () => {
    vi.stubEnv('IMAGEQUEUE_SOUND_PATH', 'expanded')
    try {
      const selected = path.join(soundDir, '$IMAGEQUEUE_SOUND_PATH%IMAGEQUEUE_SOUND_PATH%.wav ')
      fs.writeFileSync(selected, 'literal audio')
      mocks.notifications.success_file = selected
      await expect(loadAudioFile(selected)).resolves.toBe(`data:audio/mpeg;base64,${Buffer.from('literal audio').toString('base64')}`)
      await expect(loadAudioFile(selected.replaceAll('$IMAGEQUEUE_SOUND_PATH', 'expanded'))).resolves.toBeNull()
    } finally { vi.unstubAllEnvs() }
  })

  it('asks before returning bytes from an existing configured file on first use', async () => {
    const configured = path.join(soundDir, 'done.wav')
    mocks.notifications.success_file = configured
    let decide!: (answer: { response: number }) => void
    let entered!: () => void
    const enteredDialog = new Promise<void>(resolve => { entered = resolve })
    mocks.showMessageBox.mockImplementationOnce(() => {
      entered()
      return new Promise(resolve => { decide = resolve })
    })
    const read = vi.spyOn(fs.promises, 'readFile')
    try {
      const result = loadAudioFile(configured)
      await enteredDialog
      expect(read.mock.calls.some(([file]) => file === configured)).toBe(false)
      decide({ response: 1 })
      await expect(result).resolves.toContain(Buffer.from('RIFF').toString('base64'))
      expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ detail: fs.realpathSync(configured), defaultId: 0, cancelId: 0 }))
    } finally { read.mockRestore() }
  })

  it('does not grant or read sound bytes when native consent is canceled after a renderer config write', async () => {
    const configured = path.join(soundDir, 'done.wav')
    mocks.notifications.success_file = configured
    mocks.showMessageBox.mockResolvedValue({ response: 0 })
    const read = vi.spyOn(fs.promises, 'readFile')
    try {
      await expect(loadAudioFile(configured)).resolves.toBeNull()
      expect(read.mock.calls.some(([file]) => file === configured)).toBe(false)
      expect(fs.existsSync(path.join(soundDir, 'sound-file-grants.json'))).toBe(false)
      await expect(loadAudioFile(configured)).resolves.toBeNull()
      expect(mocks.showMessageBox).toHaveBeenCalledTimes(2)
    } finally { read.mockRestore() }
  })

  it('still refuses a path the user did not configure', async () => {
    mocks.notifications.success_file = path.join('~', path.basename(soundDir), 'done.wav')
    await expect(loadAudioFile(path.join(soundDir, 'other.wav'))).resolves.toBeNull()
  })
})
