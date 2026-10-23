import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hasArm64Slice } from '../../../src/main/dependencies/macho-architecture'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'iq-macho-')) })
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }) })

function thin(cpu = 0x0100000c, little = true): Buffer {
  const bytes = Buffer.alloc(32)
  const uint = (value: number, offset: number) => little ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset)
  uint(0xfeedfacf, 0)
  uint(cpu, 4)
  uint(2, 12)
  return bytes
}
function universal(wide = false, little = false): Buffer {
  const bytes = Buffer.alloc(160)
  const uint = (value: number, offset: number) => little ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset)
  const ulong = (value: bigint, offset: number) => little ? bytes.writeBigUInt64LE(value, offset) : bytes.writeBigUInt64BE(value, offset)
  uint(wide ? 0xcafebabf : 0xcafebabe, 0)
  uint(2, 4)
  for (let index = 0; index < 2; index++) {
    const row = 8 + index * (wide ? 32 : 20)
    uint(index === 0 ? 0x01000007 : 0x0100000c, row)
    if (wide) { ulong(BigInt(96 + index * 32), row + 8); ulong(32n, row + 16) }
    else { uint(96 + index * 32, row + 8); uint(32, row + 12) }
    thin(index === 0 ? 0x01000007 : 0x0100000c).copy(bytes, 96 + index * 32)
  }
  return bytes
}
async function inspect(bytes: Buffer): Promise<boolean> {
  const file = path.join(root, 'cli')
  await fs.writeFile(file, bytes)
  return hasArm64Slice(file)
}

it.each([true, false])('reads a thin arm64 header (little-endian %s) without external tools', async little => {
  vi.stubEnv('PATH', '')
  expect(await inspect(thin(0x0100000c, little))).toBe(true)
  expect(await inspect(thin(0x01000007, little))).toBe(false)
})
it.each([[false, false], [true, false], [false, true], [true, true]])('reads universal headers (64-bit %s, little-endian %s)', async (wide, little) => {
  expect(await inspect(universal(wide, little))).toBe(true)
})
it('rejects truncated, mislabelled and out-of-file architecture slices', async () => {
  expect(await inspect(thin().subarray(0, 24))).toBe(false)
  expect(await inspect(Buffer.alloc(32))).toBe(false)
  const mislabeled = universal()
  thin(0x01000007).copy(mislabeled, 128)
  expect(await inspect(mislabeled)).toBe(false)
  const outOfBounds = universal(true)
  outOfBounds.writeBigUInt64BE(2n ** 63n, 48)
  expect(await inspect(outOfBounds)).toBe(false)
  const overlap = universal()
  overlap.writeUInt32BE(96, 36)
  expect(await inspect(overlap)).toBe(false)
  const truncatedCommands = thin()
  truncatedCommands.writeUInt32LE(80, 20)
  expect(await inspect(truncatedCommands)).toBe(false)
})
it('rejects an oversized architecture table before allocating or reading it', async () => {
  const bytes = universal()
  bytes.writeUInt32BE(0xffffffff, 4)
  expect(await inspect(bytes)).toBe(false)
})
it('reads only architecture metadata from a large executable', async () => {
  const file = path.join(root, 'large-cli')
  const handle = await fs.open(file, 'w+')
  await handle.write(thin())
  await handle.truncate(64 * 1024 * 1024)
  await handle.close()
  const originalOpen = fs.open.bind(fs)
  const lengths: number[] = []
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const opened = await originalOpen(...args)
    const read = opened.read.bind(opened)
    vi.spyOn(opened, 'read').mockImplementation(((buffer: Buffer, offset: number, length: number, position: number) => {
      lengths.push(length)
      return read(buffer, offset, length, position)
    }) as typeof opened.read)
    return opened
  })
  expect(await hasArm64Slice(file)).toBe(true)
  expect(lengths).toEqual([32])
})
it('preserves cancellation and file-access failures', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(hasArm64Slice(path.join(root, 'absent'), controller.signal)).rejects.toThrow('cancelled')
  await expect(hasArm64Slice(path.join(root, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' })
})
