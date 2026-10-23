import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Directly executed ESM helper.
import { LauncherRuntime } from '../../scripts/launcher-runtime.mjs'

// This is an owned disposable Node process, not Electron or a developer app.
// It speaks the launcher protocol and quits through its own ordinary callback.
const fixture = `
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const token = process.env.IMAGEQUEUE_LAUNCH_TOKEN;
const deadline = setTimeout(() => process.exit(2), 10000);
const server = net.createServer(socket => {
  let text = '';
  socket.on('data', chunk => {
    text += chunk;
    if (!text.includes('\\n')) return;
    const request = JSON.parse(text);
    if (request.token !== token) return socket.destroy();
    socket.end(JSON.stringify({token, pid: process.pid, status: request.command === 'quit' ? 'quitting' : 'ready'}) + '\\n', () => {
      if (request.command === 'quit') server.close(() => { clearTimeout(deadline); process.exit(0); });
    });
  });
});
server.listen(0, '127.0.0.1', () => {
  const file = path.join(process.argv[1], 'imagequeue-launch-' + token + '.json');
  fs.writeFileSync(file + '.stage', JSON.stringify({token, pid: process.pid, port: server.address().port}), {mode: 0o600});
  fs.renameSync(file + '.stage', file);
});
`

describe('native disposable launcher process', () => {
  it('observes its own creation identity, authenticates readiness and confirms ordinary exit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'imagequeue-launch-native-'))
    const runtime = new LauncherRuntime({ directory })
    let launched
    try {
      launched = await runtime.exclusive(() => runtime.start(process.execPath, ['-e', fixture, directory], { timeout: 3000 }))
      const record = await runtime.read()
      expect(record.phase).toBe('ready')
      expect(record.processes).toHaveLength(1)
      await runtime.stopIfOwner(launched.token, 3000)
      await expect(launched.exited).resolves.toBe(0)
      expect(await runtime.read()).toBeNull()
    } finally {
      if (launched && await runtime.read()) await runtime.stopIfOwner(launched.token, 3000)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
