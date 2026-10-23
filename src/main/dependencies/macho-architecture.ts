import fs from 'node:fs/promises'

const ARM64 = 0x0100000c
// A universal CLI carries a handful of architectures. Bound malformed tables
// independently of the executable's potentially large payload.
const MAX_ARCH_TABLE_BYTES = 64 * 1024

/** Inspect native architecture headers without requiring Apple developer tools.
 * Checks architecture and slice bounds; the published digest verifies content. */
export async function hasArm64Slice(filePath: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  const file = await fs.open(filePath, 'r')
  try {
    const { size } = await file.stat()
    async function read(position: number, length: number): Promise<Buffer | null> {
      const bytes = Buffer.alloc(length)
      let filled = 0
      while (filled < length) {
        signal?.throwIfAborted()
        const { bytesRead } = await file.read(bytes, filled, length - filled, position + filled)
        if (!bytesRead) return null
        filled += bytesRead
      }
      signal?.throwIfAborted()
      return bytes
    }
    function nativeHeader(bytes: Buffer, sliceSize: number): boolean {
      const magic = bytes.readUInt32BE(0)
      if (magic !== 0xfeedfacf && magic !== 0xcffaedfe) return false
      const uint = (offset: number) => magic === 0xcffaedfe ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset)
      return uint(4) === ARM64 && uint(20) <= sliceSize - 32 && uint(16) <= uint(20) / 8
    }
    const header = await read(0, 32)
    if (!header) return false
    const magic = header.readUInt32BE(0)
    if (magic === 0xfeedfacf || magic === 0xcffaedfe) return nativeHeader(header, size)
    const wide = magic === 0xcafebabf || magic === 0xbfbafeca
    const little = magic === 0xbebafeca || magic === 0xbfbafeca
    if (!wide && magic !== 0xcafebabe && magic !== 0xbebafeca) return false
    const count = little ? header.readUInt32LE(4) : header.readUInt32BE(4)
    const rowSize = wide ? 32 : 20
    const tableSize = count * rowSize
    if (!count || tableSize > MAX_ARCH_TABLE_BYTES || tableSize > size - 8) return false
    const table = await read(8, tableSize)
    if (!table) return false
    const uint = (offset: number) => little ? table.readUInt32LE(offset) : table.readUInt32BE(offset)
    const ulong = (offset: number) => little ? table.readBigUInt64LE(offset) : table.readBigUInt64BE(offset)
    const slices: Array<{ cpu: number; offset: number; size: number }> = []
    for (let index = 0; index < count; index++) {
      const row = index * rowSize
      const offset = wide ? ulong(row + 8) : BigInt(uint(row + 8))
      const length = wide ? ulong(row + 16) : BigInt(uint(row + 12))
      const align = uint(row + (wide ? 24 : 16))
      if (offset < BigInt(8 + tableSize) || length < 28n || offset + length > BigInt(size)
        || align > 63 || offset % (1n << BigInt(align)) !== 0n) return false
      slices.push({ cpu: uint(row), offset: Number(offset), size: Number(length) })
    }
    slices.sort((a, b) => a.offset - b.offset)
    for (let index = 1; index < slices.length; index++) {
      if (slices[index].offset < slices[index - 1].offset + slices[index - 1].size) return false
    }
    for (const slice of slices) {
      if (slice.cpu !== ARM64 || slice.size < 32) continue
      const native = await read(slice.offset, 32)
      if (native && nativeHeader(native, slice.size)) return true
    }
    return false
  } finally {
    await file.close()
  }
}
