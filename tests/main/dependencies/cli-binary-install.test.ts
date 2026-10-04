import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The CLI install pipeline on macOS, the only platform with Draw Things, run
// with the real lipo and xattr against a local fixture: only the network
// download is replaced, by copying the fixture's bytes into the staging file
// with a quarantine flag, as a browser download would carry.

const fixture = vi.hoisted(() => ({ bytes: Buffer.alloc(0) }))

vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
vi.mock('../../../src/main/dependencies/download', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/main/dependencies/download')>(),
  downloadToFile: async (_url: string, destination: string) => {
    fs.writeFileSync(destination, fixture.bytes)
    execFileSync('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Fixture;', destination])
  },
}))

const { installCliRelease, readInstalledCliTag } = await import('../../../src/main/dependencies/cli-binary')
const { getCliBinaryPath, getTempDir } = await import('../../../src/main/dependencies/paths')

// The smallest Mach-O lipo reads: a 64-bit executable header of one architecture.
function machO(cpuType: number, cpuSubtype: number): Buffer {
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(cpuType, 4)
  header.writeUInt32LE(cpuSubtype, 8)
  header.writeUInt32LE(2, 12)
  return header
}
const ARM64 = machO(0x0100000c, 0)
const X86_64 = machO(0x01000007, 3)

function release(bytes: Buffer) {
  fixture.bytes = bytes
  return { tag: 'v1.20261004.0', assetUrl: 'https://fixture.invalid/draw-things-cli', sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
}

function attributes(file: string): string {
  return execFileSync('xattr', [file], { encoding: 'utf8' })
}

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-cli-install-'))
  vi.stubEnv('IMAGEQUEUE_DATA_DIR', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(home, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'darwin')('installCliRelease on macOS', () => {
  it('installs an arm64 binary executable, with the quarantine flag removed, and records its release', async () => {
    const arm64 = release(ARM64)
    await installCliRelease(arm64)

    const installed = getCliBinaryPath()
    expect(fs.readFileSync(installed)).toEqual(ARM64)
    expect(fs.statSync(installed).mode & 0o777).toBe(0o755)
    expect(attributes(installed)).not.toContain('com.apple.quarantine')
    expect(readInstalledCliTag()).toBe(arm64.tag)
    expect(fs.readdirSync(getTempDir())).toEqual([])
  })

  it('rejects an x86-only binary and leaves nothing installed or staged', async () => {
    await expect(installCliRelease(release(X86_64))).rejects.toThrow('not native arm64')

    expect(fs.existsSync(getCliBinaryPath())).toBe(false)
    expect(readInstalledCliTag()).toBeNull()
    expect(fs.readdirSync(getTempDir())).toEqual([])
  })
})
