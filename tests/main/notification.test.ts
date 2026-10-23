import fs from 'fs'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
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

let sender: EventEmitter & { isDestroyed: () => boolean }
const { serveAudio, releaseAudioFile } = await import('../../src/main/audio-protocol')

function loadAudioFile(filePath: string): Promise<string | null> {
  return mocks.handlers.get('notification:loadAudioFile')!({ sender }, filePath) as Promise<string | null>
}

// A sound path the user typed is resolved before it is compared or read, so a
// home-relative setting plays whatever directory the app was launched from.
describe('notification:loadAudioFile', () => {
  let soundDir: string

  beforeEach(() => {
    sender = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    mocks.showMessageBox.mockReset().mockResolvedValue({ response: 1 })
    mocks.notifications.success_file = ''
    mocks.notifications.failure_file = ''
    soundDir = fs.mkdtempSync(path.join(os.homedir(), 'sounds-'))
    mocks.root = soundDir
    fs.writeFileSync(path.join(soundDir, 'done.wav'), 'RIFF')
  })

  afterEach(() => {
    sender.emit('destroyed')
    vi.restoreAllMocks()
    vi.useRealTimers()
    fs.rmSync(soundDir, { recursive: true, force: true })
  })

  it('reads a configured home-relative path', async () => {
    const configured = path.join('~', path.basename(soundDir), 'done.wav')
    mocks.notifications.success_file = configured
    await expect(loadAudioFile(configured)).resolves.toMatch(/^iq-audio:\/\/sound\/[a-f0-9-]+$/)
  })

  it('reads a configured path relative to the home directory', async () => {
    const configured = path.join(path.basename(soundDir), 'done.wav')
    mocks.notifications.success_file = configured
    await expect(loadAudioFile(configured)).resolves.toMatch(/^iq-audio:\/\/sound\/[a-f0-9-]+$/)
  })

  it('reads literal selected names even when their variables exist in the environment', async () => {
    vi.stubEnv('IMAGEQUEUE_SOUND_PATH', 'expanded')
    try {
      const selected = path.join(soundDir, '$IMAGEQUEUE_SOUND_PATH%IMAGEQUEUE_SOUND_PATH%.wav ')
      fs.writeFileSync(selected, 'literal audio')
      mocks.notifications.success_file = selected
      await expect(loadAudioFile(selected)).resolves.toMatch(/^iq-audio:\/\/sound\/[a-f0-9-]+$/)
      await expect(loadAudioFile(selected.replaceAll('$IMAGEQUEUE_SOUND_PATH', 'expanded'))).resolves.toBeNull()
    } finally { vi.unstubAllEnvs() }
  })

  it('asks before issuing a stream URL from an existing configured file on first use', async () => {
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
      await expect(result).resolves.toMatch(/^iq-audio:\/\/sound\//)
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

  it('streams current bytes and ranges without reading the audio into an IPC result', async () => {
    const file = path.join(soundDir, 'done.wav')
    mocks.notifications.success_file = file
    const read = vi.spyOn(fs.promises, 'readFile')
    const url = (await loadAudioFile(file))!
    expect(url).not.toContain(soundDir)
    const response = await serveAudio(new Request(url))
    expect(response.headers.get('Content-Type')).toBe('audio/wav')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('RIFF')
    expect(read.mock.calls.some(([name]) => name === file)).toBe(false)
    fs.writeFileSync(file, 'changed sound')
    const range = await serveAudio(new Request(url, { headers: { Range: 'bytes=1-4' } }))
    expect(range.status).toBe(206)
    expect(range.headers.get('Content-Range')).toBe('bytes 1-4/13')
    expect(await range.text()).toBe('hang')
    const suffix = await serveAudio(new Request(url, { headers: { Range: 'bytes=-5' } }))
    expect(await suffix.text()).toBe('sound')
    const head = await serveAudio(new Request(url, { method: 'HEAD' }))
    expect(head.headers.get('Content-Length')).toBe('13')
    expect(await head.text()).toBe('')
    for (const range of ['bytes=99-', 'bytes=-0', 'bytes=3-1', 'bytes=0-1,3-4']) {
      expect((await serveAudio(new Request(url, { headers: { Range: range } }))).status).toBe(416)
    }
    expect((await serveAudio(new Request(url + '?other'))).status).toBe(404)
    expect((await serveAudio(new Request(url, { method: 'POST' }))).status).toBe(405)
  })

  it('rechecks authorization and revokes resources on replacement, release and sender destruction', async () => {
    mocks.notifications.success_file = path.join(soundDir, 'done.wav')
    const first = (await loadAudioFile(mocks.notifications.success_file))!
    const second = (await loadAudioFile(mocks.notifications.success_file))!
    expect((await serveAudio(new Request(first))).status).toBe(404)
    releaseAudioFile(second, {} as WebContents)
    expect(await (await serveAudio(new Request(second))).text()).toBe('RIFF')
    releaseAudioFile(second, sender as unknown as WebContents)
    expect((await serveAudio(new Request(second))).status).toBe(404)
    const third = (await loadAudioFile(mocks.notifications.success_file))!
    mocks.notifications.success_file = ''
    expect((await serveAudio(new Request(third))).status).toBe(403)
    sender.emit('destroyed')
    expect((await serveAudio(new Request(third))).status).toBe(404)
  })

  it('retries a previously missing configured file instead of caching absence', async () => {
    const file = path.join(soundDir, 'later.wav')
    mocks.notifications.success_file = file
    expect(await loadAudioFile(file)).toBeNull()
    fs.writeFileSync(file, 'available later')
    const url = (await loadAudioFile(file))!
    expect(await (await serveAudio(new Request(url))).text()).toBe('available later')
  })

  it.skipIf(process.platform === 'win32')('refuses a retargeted symlink without asking from the resource request', async () => {
    const file = path.join(soundDir, 'linked.wav')
    fs.symlinkSync(path.join(soundDir, 'done.wav'), file)
    mocks.notifications.success_file = file
    const url = (await loadAudioFile(file))!
    fs.writeFileSync(path.join(soundDir, 'other.wav'), 'not granted')
    fs.unlinkSync(file)
    fs.symlinkSync(path.join(soundDir, 'other.wav'), file)
    mocks.showMessageBox.mockClear()
    expect((await serveAudio(new Request(url))).status).toBe(403)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })

  it('closes a late opened file after its deadline while another sound remains available', async () => {
    const first = path.join(soundDir, 'done.wav')
    const second = path.join(soundDir, 'other.wav')
    fs.writeFileSync(second, 'second sound')
    mocks.notifications.success_file = first
    mocks.notifications.failure_file = second
    const url = (await loadAudioFile(first))!
    const canonical = fs.realpathSync(first)
    const opened = await fs.promises.open(canonical, 'r')
    let complete!: (file: typeof opened) => void
    let entered!: () => void
    const entering = new Promise<void>((resolve) => { entered = resolve })
    const open = fs.promises.open.bind(fs.promises)
    vi.spyOn(fs.promises, 'open').mockImplementation((file, flags, mode) => {
      if (file === canonical) { entered(); return new Promise((resolve) => { complete = resolve }) }
      return open(file, flags, mode)
    })
    vi.useFakeTimers()
    const waiting = serveAudio(new Request(url))
    await entering
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await waiting).status).toBe(500)
    const next = (await loadAudioFile(second))!
    expect(await (await serveAudio(new Request(next))).text()).toBe('second sound')
    let closed!: () => void
    const closing = new Promise<void>((resolve) => { closed = resolve })
    const close = opened.close.bind(opened)
    vi.spyOn(opened, 'close').mockImplementation(async () => { await close(); closed() })
    complete(opened)
    await closing
    expect(opened.fd).toBe(-1)
  })

  it('closes the file stream when the media consumer cancels and leaves its source untouched', async () => {
    const file = path.join(soundDir, 'done.wav')
    const bytes = 'sound'.repeat(100_000)
    fs.writeFileSync(file, bytes)
    mocks.notifications.success_file = file
    const url = (await loadAudioFile(file))!
    const open = fs.promises.open.bind(fs.promises)
    let stream: fs.ReadStream | undefined
    vi.spyOn(fs.promises, 'open').mockImplementation(async (name, flags, mode) => {
      const handle = await open(name, flags, mode)
      const create = handle.createReadStream.bind(handle)
      vi.spyOn(handle, 'createReadStream').mockImplementation((options) => { stream = create(options); return stream })
      return handle
    })
    const response = await serveAudio(new Request(url))
    expect(stream).toBeDefined()
    const closed = new Promise<void>((resolve) => stream!.once('close', resolve))
    await response.body!.cancel()
    await closed
    expect(stream!.closed).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes)
  })

  it('revokes audio resources on page navigation and renderer loss', async () => {
    mocks.notifications.success_file = path.join(soundDir, 'done.wav')
    const first = (await loadAudioFile(mocks.notifications.success_file))!
    sender.emit('did-start-navigation', {}, 'file:///index.html', false, true)
    expect((await serveAudio(new Request(first))).status).toBe(404)
    expect(sender.listenerCount('destroyed')).toBe(0)
    const second = (await loadAudioFile(mocks.notifications.success_file))!
    sender.emit('render-process-gone')
    expect((await serveAudio(new Request(second))).status).toBe(404)
    expect(sender.listenerCount('did-start-navigation')).toBe(0)
  })

})
