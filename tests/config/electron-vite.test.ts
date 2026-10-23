import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'
// @ts-expect-error Directly executed ESM helper.
import { RENDERER_HOST, RENDERER_PORT } from '../../scripts/launcher-runtime.mjs'

describe('Electron development endpoint', () => {
  it('uses the exact strict loopback endpoint checked by the launcher', () => {
    expect(config.renderer?.server).toMatchObject({ strictPort: true, host: RENDERER_HOST, port: RENDERER_PORT })
  })
  it.each(['run-dev', 'run-built', 'rebuild'])('routes both %s wrappers through shared orchestration', (mode) => {
    for (const extension of ['command', 'ps1']) {
      const source = readFileSync(new URL(`../../scripts/${mode}.${extension}`, import.meta.url), 'utf8')
      expect(source).toMatch(new RegExp(`launcher\\.mjs[^\\n]+${mode}`))
    }
  })
})
