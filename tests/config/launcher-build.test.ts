import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error Plain ESM launcher helpers intentionally have no declaration file.
import { buildPackage, publishPackage, validatePackage } from '../../scripts/launcher-build.mjs'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'imagequeue-launcher-build-test-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

function packagePaths(output: string, platform: 'darwin' | 'win32') {
  return platform === 'win32'
    ? { executable: join(output, 'win-unpacked', 'ImageQueue.exe'), asar: join(output, 'win-unpacked', 'resources', 'app.asar') }
    : { executable: join(output, 'mac-arm64', 'ImageQueue.app', 'Contents', 'MacOS', 'ImageQueue'),
      asar: join(output, 'mac-arm64', 'ImageQueue.app', 'Contents', 'Resources', 'app.asar') }
}

async function packagedFixture(output: string, platform: 'darwin' | 'win32') {
  const files = packagePaths(output, platform)
  await mkdir(dirname(files.executable), { recursive: true })
  await mkdir(dirname(files.asar), { recursive: true })
  // These nonempty files are validation fixtures only, never executable work.
  await writeFile(files.executable, 'executable fixture', { mode: 0o700 })
  await writeFile(files.asar, 'archive fixture')
  await chmod(files.executable, 0o700)
  return files
}

async function markedDirectory(directory: string, content: string) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'marker'), content)
}
const marker = (directory: string) => readFile(join(directory, 'marker'), 'utf8')

describe.each(['darwin', 'win32'] as const)('launcher package validation on %s', (platform) => {
  it('rejects missing executable and app archive independently', async () => {
    const output = join(root, 'candidate')
    let files = await packagedFixture(output, platform)
    await rm(files.executable)
    await expect(validatePackage(output, platform)).rejects.toMatchObject({ code: 'ENOENT' })
    files = await packagedFixture(output, platform)
    await rm(files.asar)
    await expect(validatePackage(output, platform)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns the executable only for a complete nonempty package', async () => {
    const output = join(root, 'candidate')
    const files = await packagedFixture(output, platform)
    await expect(validatePackage(output, platform)).resolves.toBe(files.executable)
    await writeFile(files.asar, '')
    await expect(validatePackage(output, platform)).rejects.toThrow('packaged app is incomplete')
  })
})

describe('launcher package publication', () => {
  it.each([false, true])('publishes the candidate and removes the previous backup (prior output: %s)', async (prior) => {
    const candidate = join(root, 'candidate')
    const output = join(root, 'dist')
    await markedDirectory(candidate, 'new runnable app')
    if (prior) await markedDirectory(output, 'previous runnable app')
    await publishPackage(candidate, output)
    expect(await marker(output)).toBe('new runnable app')
    expect(await readdir(root)).toEqual(['dist'])
  })

  it('restores prior output when the candidate rename fails', async () => {
    const candidate = join(root, 'candidate')
    const output = join(root, 'dist')
    await markedDirectory(candidate, 'new runnable app')
    await markedDirectory(output, 'previous runnable app')
    const publicationError = Object.assign(new Error('candidate rename failed'), { code: 'EACCES' })
    const move = vi.fn(async (from: string, to: string) => {
      if (from === candidate) throw publicationError
      await rename(from, to)
    })
    await expect(publishPackage(candidate, output, move)).rejects.toBe(publicationError)
    expect(await marker(output)).toBe('previous runnable app')
    expect(await marker(candidate)).toBe('new runnable app')
    expect((await readdir(root)).sort()).toEqual(['candidate', 'dist'])
  })

  it('retains the named previous backup if rollback also fails', async () => {
    const candidate = join(root, 'candidate')
    const output = join(root, 'dist')
    await markedDirectory(candidate, 'new runnable app')
    await markedDirectory(output, 'previous runnable app')
    const publicationError = new Error('candidate rename failed')
    const rollbackError = new Error('rollback rename failed')
    let backup = ''
    const move = vi.fn(async (from: string, to: string) => {
      if (from === candidate) throw publicationError
      if (to === output) throw rollbackError
      backup = to
      await rename(from, to)
    })
    await expect(publishPackage(candidate, output, move)).rejects.toMatchObject({
      name: 'AggregateError', errors: [publicationError, rollbackError],
    })
    expect(backup.startsWith(`${output}.previous-`)).toBe(true)
    expect(await marker(backup)).toBe('previous runnable app')
    expect(await marker(candidate)).toBe('new runnable app')
    expect((await readdir(root)).sort()).toEqual(['candidate', backup.slice(root.length + 1)].sort())
  })
})

describe('launcher build isolation', () => {
  it.each([1, 2])('preserves prior dist and removes its private candidate when build step %i fails', async (failAt) => {
    const output = join(root, 'dist')
    await markedDirectory(output, 'previous runnable app')
    const failure = new Error('injected build failure')
    let calls = 0
    // Injection exercises orchestration without invoking a build or installer.
    const run = vi.fn(async (_command: string, _args: string[]) => {
      if (++calls === failAt) throw failure
    })
    await expect(buildPackage(root, run, 'darwin')).rejects.toBe(failure)
    expect(run).toHaveBeenCalledTimes(failAt)
    expect(await marker(output)).toBe('previous runnable app')
    expect(await readdir(root)).toEqual(['dist'])
  })
})
