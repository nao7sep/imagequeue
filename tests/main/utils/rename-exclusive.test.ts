import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renameExclusive } from '../../../src/main/utils/rename-exclusive'

// Exercise the actual no-replace primitive supplied by the current OS. Stages
// are complete and synced before publication, as in the output writer.
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'imagequeue-exclusive-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

async function stage(name: string, bytes: Buffer): Promise<string> {
  const file = path.join(root, name)
  const handle = await fs.open(file, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    if (process.platform !== 'win32') await handle.chmod(0o640)
    const time = new Date('2026-01-02T03:04:05.000Z')
    await handle.utimes(time, time)
    await handle.sync()
  } finally { await handle.close() }
  return file
}

describe('native exclusive rename', () => {
  it('moves complete synced bytes and their file identity and metadata to a free name', async () => {
    const bytes = Buffer.alloc(128 * 1024, 0x37)
    const source = await stage('ready.tmp', bytes)
    const destination = path.join(root, 'result.png')
    const before = await fs.stat(source)
    expect(await renameExclusive(source, destination)).toBe(true)
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(destination)).toEqual(bytes)
    const after = await fs.stat(destination)
    expect(after.ino).toBe(before.ino)
    expect(after.size).toBe(before.size)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    if (process.platform !== 'win32') expect(after.mode & 0o777).toBe(before.mode & 0o777)
  })

  it('preserves both the stage and an occupied destination', async () => {
    const sourceBytes = Buffer.alloc(64 * 1024, 0x61)
    const targetBytes = Buffer.alloc(32 * 1024, 0x62)
    const source = await stage('source.tmp', sourceBytes)
    const destination = await stage('occupied.png', targetBytes)
    const sourceBefore = await fs.stat(source)
    const destinationBefore = await fs.stat(destination)
    expect(await renameExclusive(source, destination)).toBe(false)
    expect(await fs.readFile(source)).toEqual(sourceBytes)
    expect(await fs.readFile(destination)).toEqual(targetBytes)
    expect((await fs.stat(source)).ino).toBe(sourceBefore.ino)
    expect((await fs.stat(destination)).ino).toBe(destinationBefore.ino)
  })

  it('allows exactly one simultaneous stage to claim the destination and leaves the loser intact', async () => {
    const bytes = [Buffer.alloc(128 * 1024, 0x41), Buffer.alloc(128 * 1024, 0x42)]
    const sources = await Promise.all(bytes.map((value, index) => stage(`stage-${index}.tmp`, value)))
    const identities = await Promise.all(sources.map(file => fs.stat(file)))
    const destination = path.join(root, 'shared.png')
    const outcomes = await Promise.all(sources.map(source => renameExclusive(source, destination)))
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const winner = outcomes.indexOf(true)
    const loser = outcomes.indexOf(false)
    expect(await fs.readFile(destination)).toEqual(bytes[winner])
    expect((await fs.stat(destination)).ino).toBe(identities[winner].ino)
    await expect(fs.stat(sources[winner])).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(sources[loser])).toEqual(bytes[loser])
    expect((await fs.stat(sources[loser])).ino).toBe(identities[loser].ino)
  })

  it('reports a missing destination parent while preserving the complete stage', async () => {
    const bytes = Buffer.alloc(64 * 1024, 0x55)
    const source = await stage('recoverable.tmp', bytes)
    const destination = path.join(root, 'missing-parent', 'result.png')
    await expect(renameExclusive(source, destination)).rejects.toMatchObject({
      syscall: 'rename-exclusive', path: source, dest: destination,
    })
    expect(await fs.readFile(source)).toEqual(bytes)
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
