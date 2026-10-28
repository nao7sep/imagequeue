import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'
// @ts-expect-error Directly executed ESM helper.
import { RENDERER_HOST, RENDERER_PORT } from '../../scripts/launcher-runtime.mjs'

describe('Electron development endpoint', () => {
  it('uses the exact strict loopback endpoint checked by the launcher', () => {
    expect(config.renderer?.server).toMatchObject({ strictPort: true, host: RENDERER_HOST, port: RENDERER_PORT })
  })
})
