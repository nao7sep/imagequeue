// Run with `node tests/native/rename-fat.mjs` on macOS. This bounded native
// qualification creates a disposable 16 MiB MS-DOS disk image, mounts it without
// opening Finder, exercises the production exclusive rename, and detaches it.
// It is deliberately outside the default suite: mounting requires host support.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { renameExclusive } from '../../src/main/utils/rename-exclusive.ts'

if (process.argv.includes('--help')) {
  console.log('node tests/native/rename-fat.mjs — test exclusive rename on a disposable macOS MS-DOS volume')
  process.exit(0)
}
if (process.platform !== 'darwin') throw new Error('This disk-image fixture requires macOS')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imagequeue-fat-'))
const mount = path.join(root, 'volume')
let attached = false
try {
  const image = path.join(root, 'fixture.dmg')
  execFileSync('hdiutil', ['create', '-size', '16m', '-fs', 'MS-DOS', '-volname', 'IQPublicationFixture', image], { stdio: 'pipe' })
  await fs.mkdir(mount)
  execFileSync('hdiutil', ['attach', '-nobrowse', '-noautoopen', '-mountpoint', mount, image], { stdio: 'pipe' })
  attached = true
  const sources = [path.join(mount, 'one.tmp'), path.join(mount, 'two.tmp')]
  const values = [Buffer.alloc(128 * 1024, 0x41), Buffer.alloc(128 * 1024, 0x42)]
  for (let index = 0; index < sources.length; index++) {
    const file = await fs.open(sources[index], 'wx')
    try { await file.writeFile(values[index]); await file.sync() } finally { await file.close() }
  }
  await assert.rejects(fs.link(sources[0], path.join(mount, 'hardlink')), { code: 'ENOTSUP' })
  const destination = path.join(mount, 'complete.png')
  const results = await Promise.all(sources.map(source => renameExclusive(source, destination)))
  assert.equal(results.filter(Boolean).length, 1)
  const winner = results.indexOf(true)
  const loser = results.indexOf(false)
  assert.deepEqual(await fs.readFile(destination), values[winner])
  assert.deepEqual(await fs.readFile(sources[loser]), values[loser])
  assert.equal(await renameExclusive(sources[loser], destination), false)
  assert.deepEqual(await fs.readFile(destination), values[winner])
  assert.equal(await renameExclusive(sources[loser], path.join(mount, 'other.png')), true)
  assert.deepEqual(await fs.readFile(path.join(mount, 'other.png')), values[loser])
  console.log('Exclusive rename preserved complete bytes and collisions on a volume without hard links.')
} finally {
  // Never unlink a mounted backing image if detach fails; retain it for cleanup.
  if (attached) execFileSync('hdiutil', ['detach', mount], { stdio: 'pipe' })
  await fs.rm(root, { recursive: true, force: true })
}
