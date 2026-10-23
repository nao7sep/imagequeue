import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ root: '', showMessageBox: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox: mocks.showMessageBox },
}))
vi.mock('../../src/main/config', () => ({ getDataDir: () => mocks.root }))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: () => ({ t: (key: string) => key }) }))

const sender = {} as WebContents
const grants = () => import('../../src/main/sound-file-grants')
let first: string
let second: string

beforeEach(() => {
  vi.resetModules()
  mocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
  mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-sound-grants-'))
  first = path.join(mocks.root, 'first.wav')
  second = path.join(mocks.root, 'second.wav')
  fs.writeFileSync(first, 'first sound')
  fs.writeFileSync(second, 'second sound')
})
afterEach(() => fs.rmSync(mocks.root, { recursive: true, force: true }))

describe('native sound file grants', () => {
  it('returns no authorization or persisted grant after Cancel', async () => {
    expect(await (await grants()).authorizedSoundFile(first, sender)).toBeNull()
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    expect(fs.existsSync(path.join(mocks.root, 'sound-file-grants.json'))).toBe(false)
  })

  it('reuses approval for the canonical file after a module reload and asks for a different path', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    expect(await (await grants()).authorizedSoundFile(first, sender)).toBe(fs.realpathSync(first))
    vi.resetModules()
    mocks.showMessageBox.mockClear()
    expect(await (await grants()).authorizedSoundFile(first, sender)).toBe(fs.realpathSync(first))
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(await (await grants()).authorizedSoundFile(second, sender)).toBeNull()
    expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ detail: fs.realpathSync(second) }))
  })

  it('authorizes exactly a file selected by the native picker', async () => {
    await (await grants()).grantPickedSoundFile(first)
    expect(await (await grants()).authorizedSoundFile(first, sender)).toBe(fs.realpathSync(first))
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(await (await grants()).authorizedSoundFile(second, sender)).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('does not reuse a symlink grant after its destination changes', async () => {
    const link = path.join(mocks.root, 'selected.wav')
    fs.symlinkSync(first, link)
    await (await grants()).grantPickedSoundFile(link)
    expect(await (await grants()).authorizedSoundFile(link, sender)).toBe(fs.realpathSync(first))
    fs.unlinkSync(link)
    fs.symlinkSync(second, link)
    expect(await (await grants()).authorizedSoundFile(link, sender)).toBeNull()
    expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ detail: fs.realpathSync(second) }))
  })

  it('asks again when a previous grant write failed', async () => {
    const module = await grants()
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    try {
      await expect(module.grantPickedSoundFile(first)).rejects.toThrow('disk unavailable')
      expect(await module.authorizedSoundFile(first, sender)).toBeNull()
      expect(mocks.showMessageBox).toHaveBeenCalledOnce()
      mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
      expect(await module.authorizedSoundFile(first, sender)).toBe(fs.realpathSync(first))
    } finally { rename.mockRestore() }
  })

  it('does not trust paths in an unsupported grant format', async () => {
    fs.writeFileSync(path.join(mocks.root, 'sound-file-grants.json'), JSON.stringify({ formatVersion: 2, paths: [fs.realpathSync(first)] }))
    expect(await (await grants()).authorizedSoundFile(first, sender)).toBeNull()
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
  })

  it('does not ask or grant an empty or missing file', async () => {
    expect(await (await grants()).authorizedSoundFile('', sender)).toBeNull()
    expect(await (await grants()).authorizedSoundFile(path.join(mocks.root, 'missing.wav'), sender)).toBeNull()
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })
})
