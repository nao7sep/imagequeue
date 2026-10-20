import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import config from '../../electron.vite.config'

// The development launchers wait for the renderer's dev server and check its
// port is free; each declares the host and port once, and they must be the
// ones electron-vite serves on, strictly.
const launcher = (name: string): string => readFileSync(new URL(`../../scripts/${name}`, import.meta.url), 'utf8')

describe('Electron development endpoint', () => {
  it('is the strict loopback endpoint both run-dev launchers wait for', () => {
    const server = config.renderer?.server
    expect(server?.strictPort).toBe(true)
    const command = launcher('run-dev.command')
    const powershell = launcher('run-dev.ps1')
    expect(/^RENDERER_HOST="([^"]+)"$/m.exec(command)?.[1]).toBe(server?.host)
    expect(/^RENDERER_PORT="(\d+)"$/m.exec(command)?.[1]).toBe(String(server?.port))
    expect(/^\$rendererHost = "([^"]+)"$/m.exec(powershell)?.[1]).toBe(server?.host)
    expect(/^\$rendererPort = "(\d+)"$/m.exec(powershell)?.[1]).toBe(String(server?.port))
  })
})
