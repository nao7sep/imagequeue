import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveStorageRoot } from '../../../src/main/config/storage-root'

const ENV_VAR = 'IMAGEQUEUE_HOME'

describe('resolveStorageRoot (IMAGEQUEUE_HOME)', () => {
  let tmpBase: string
  const original = process.env[ENV_VAR]

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-root-'))
    delete process.env[ENV_VAR]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = original
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('defaults to <homedir>/.imagequeue when the override is unset', () => {
    expect(resolveStorageRoot()).toBe(path.join(os.homedir(), '.imagequeue'))
  })

  it('treats an empty/whitespace override as unset', () => {
    process.env[ENV_VAR] = '   '
    expect(resolveStorageRoot()).toBe(path.join(os.homedir(), '.imagequeue'))
  })

  it('relocates the whole root to an absolute override and creates it', () => {
    const target = path.join(tmpBase, 'relocated')
    process.env[ENV_VAR] = target
    const root = resolveStorageRoot()
    expect(root).toBe(path.resolve(target))
    expect(fs.statSync(root).isDirectory()).toBe(true)
  })

  it('expands a leading ~ against the home directory', () => {
    process.env[ENV_VAR] = '~/.imagequeue-test-home-expand'
    const root = resolveStorageRoot()
    expect(root).toBe(path.join(os.homedir(), '.imagequeue-test-home-expand'))
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('resolves a relative override against HOME, never the working directory', () => {
    process.env[ENV_VAR] = 'relative-imagequeue-root-xyz'
    const root = resolveStorageRoot()
    expect(root).toBe(path.resolve(os.homedir(), 'relative-imagequeue-root-xyz'))
    expect(root).not.toBe(path.resolve(process.cwd(), 'relative-imagequeue-root-xyz'))
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('throws a clear startup error when the override is unusable (path is a file)', () => {
    const filePath = path.join(tmpBase, 'not-a-dir')
    fs.writeFileSync(filePath, 'x')
    process.env[ENV_VAR] = filePath
    expect(() => resolveStorageRoot()).toThrow(/IMAGEQUEUE_HOME/)
  })
})
