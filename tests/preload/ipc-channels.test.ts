import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The preload and the main process name each IPC channel separately, as a
// string on each side. A channel renamed or dropped on one side compiles and
// fails only when the renderer calls it, so the two sides are compared here.

const root = fileURLToPath(new URL('../../', import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []
})
const mainSources = walk(join(root, 'src/main')).map((path) => readFileSync(path, 'utf8'))
const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')

const channels = (sources: string[], pattern: RegExp): Set<string> =>
  new Set(sources.flatMap((source) => [...source.matchAll(pattern)].map((match) => match[1]!)))

// main registers invoke handlers through ipc-boundary's handle() and, for the
// quit question that must answer while quitting, through ipcMain directly.
const handled = channels(mainSources, /(?:^|[^.\w]|ipcMain\.)handle\(\s*'([^']+)'/g)
const received = channels(mainSources, /ipcMain\.on\(\s*'([^']+)'/g)
const invoked = channels([preload], /ipcRenderer\.invoke\(\s*'([^']+)'/g)
const sent = channels([preload], /ipcRenderer\.send\(\s*'([^']+)'/g)
const listened = channels([preload], /ipcRenderer\.(?:on|once)\(\s*'([^']+)'/g)

describe('IPC channels', () => {
  it('finds channels on both sides', () => {
    expect(handled.size).toBeGreaterThan(0)
    expect(invoked.size).toBeGreaterThan(0)
    expect(listened.size).toBeGreaterThan(0)
  })

  it('handles every channel the preload invokes, and nothing it does not', () => {
    expect([...invoked].filter((channel) => !handled.has(channel))).toEqual([])
    expect([...handled].filter((channel) => !invoked.has(channel))).toEqual([])
  })

  it('receives every channel the preload sends, and nothing it does not', () => {
    expect([...sent].filter((channel) => !received.has(channel))).toEqual([])
    expect([...received].filter((channel) => !sent.has(channel))).toEqual([])
  })

  // Main sends through broadcast helpers and channel constants, so the check
  // is that main names each channel the preload listens on.
  it('names in main every channel the preload listens on', () => {
    const named = mainSources.join('\n')
    expect([...listened].filter((channel) => !named.includes(`'${channel}'`))).toEqual([])
  })
})
