import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProcesses, liveRecorded, processIdentity, retainProcessTree } from './launcher-processes.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RENDERER_HOST = '127.0.0.1';
export const RENDERER_PORT = 20641;
const namespace = `imagequeue-launcher-${createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 20)}`;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
export const handshakePath = (token, directory = tmpdir()) => join(directory, `imagequeue-launch-${token}.json`);

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeJson(file, value) {
  const stage = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(stage, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(stage, file);
  } finally { await rm(stage, { force: true }); }
}

export function requestControl(endpoint, command) {
  return new Promise((resolveRequest, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: endpoint.port });
    let text = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolveRequest(value);
    };
    const timer = setTimeout(() => finish(new Error('The owned app did not answer its launcher.')), 5000);
    socket.once('error', (error) => finish(error));
    socket.once('connect', () => socket.write(`${JSON.stringify({ token: endpoint.token, command })}\n`));
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8');
      if (text.length > 1024) { finish(new Error('Invalid launcher control response.')); return; }
      const end = text.indexOf('\n');
      if (end < 0) return;
      try {
        const value = JSON.parse(text.slice(0, end));
        if (value.token !== endpoint.token || value.pid !== endpoint.pid || !['starting', 'ready', 'failed', 'quitting'].includes(value.status)) {
          throw new Error('The launcher endpoint belongs to a different app generation.');
        }
        finish(null, value);
      } catch (error) { finish(error); }
    });
    socket.once('end', () => finish(new Error('The owned app closed its launcher connection before answering.')));
  });
}

/** One owner covers replacement/build/start. The runtime record outlives this
 * helper; old dev cleanup can request closure only for its exact generation. */
export class LauncherRuntime {
  constructor({ directory = tmpdir(), processes = listProcesses, control = requestControl, now = () => performance.now(), sleep = delay } = {}) {
    this.directory = directory;
    this.file = join(directory, `${namespace}.json`);
    this.lock = `${this.file}.lock`;
    this.processes = processes;
    this.control = control;
    this.now = now;
    this.sleep = sleep;
  }
  async exclusive(operation) {
    try { await mkdir(this.lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw new Error(`Another ImageQueue launch/build is in progress, or its launcher was interrupted. Close that launcher first. If no launcher is running, remove only ${this.lock} and retry.`);
    }
    try {
      await writeJson(join(this.lock, 'owner.json'), { pid: process.pid });
      return await operation();
    } finally { await rm(this.lock, { recursive: true, force: true }); }
  }
  read() { return readJson(this.file); }
  save(record) { return writeJson(this.file, record); }
  async endpoint(token) {
    const endpoint = await readJson(handshakePath(token, this.directory));
    if (endpoint && (endpoint.token !== token || !Number.isSafeInteger(endpoint.pid) || endpoint.pid <= 0 || !Number.isInteger(endpoint.port) || endpoint.port <= 0 || endpoint.port > 65535)) {
      throw new Error('The owned app has an invalid launcher handshake. Close it normally and retry.');
    }
    return endpoint;
  }
  async stopCurrent(expectedToken, timeout = 30000) {
    const record = await this.read();
    if (!record || (expectedToken !== undefined && record.token !== expectedToken)) return;
    let current = await this.processes();
    const endpoint = await this.endpoint(record.token);
    // A startup interrupted before its main PID was recorded can still prove
    // ownership through the generation's authenticated, live service.
    const endpointProcess = endpoint && current.find((item) => item.pid === endpoint.pid);
    if (endpoint && !record.processes.some((item) => item.pid === endpointProcess?.pid && item.created === endpointProcess.created)) {
      let authenticated = false;
      try {
        await this.control(endpoint, 'status');
        authenticated = true;
      } catch (error) {
        if (record.phase !== 'ready') throw new Error('The interrupted app launch cannot be confirmed closed. Close it normally before removing its launcher record.', { cause: error });
      }
      if (authenticated) {
        // A dev reload may have published its new handshake after our snapshot.
        current = await this.processes();
        const main = current.find((item) => item.pid === endpoint.pid);
        if (!main) throw new Error('The owned app answered but its process identity could not be observed. Retry ordinary closure.');
        record.processes.push(processIdentity(main));
      }
    }
    record.processes = retainProcessTree(record.processes, current);
    await this.save(record);
    if (liveRecorded(record.processes, current).length) {
      if (!endpoint) throw new Error('The owned app is still starting and cannot accept Quit yet. Close it normally or wait, then retry.');
      let requestError;
      try { await this.control(endpoint, 'quit'); } catch (error) { requestError = error; }
      const deadline = this.now() + timeout;
      while (true) {
        current = await this.processes();
        const retained = retainProcessTree(record.processes, current);
        if (retained.length !== record.processes.length) { record.processes = retained; await this.save(record); }
        if (!liveRecorded(record.processes, current).length) break;
        if (requestError) throw new Error('The owned app could not receive ordinary Quit. Close it normally and retry; no process was forced to exit.', { cause: requestError });
        if (this.now() >= deadline) throw new Error('ImageQueue or its recorded child processes are still running. Finish or cancel work and quit normally, then retry. Nothing was force-closed.');
        await this.sleep(100);
      }
    } else if (record.phase === 'starting' && !endpoint) {
      throw new Error('An interrupted launch has an unknown outcome. Close any app it opened before removing its launcher record.');
    }
    await rm(this.file, { force: true });
    await rm(handshakePath(record.token, this.directory), { force: true });
  }
  async stopIfOwner(token, timeout) {
    return this.exclusive(() => this.stopCurrent(token, timeout));
  }
  async start(executable, args, { development = false, timeout = 60000 } = {}) {
    const record = { token: randomUUID(), phase: 'starting', processes: [] };
    await this.save(record);
    const child = spawn(executable, args, {
      cwd: REPO_ROOT, detached: true, windowsHide: true,
      stdio: development ? 'inherit' : 'ignore',
      env: { ...process.env, IMAGEQUEUE_LAUNCH_TOKEN: record.token },
    });
    let spawnError;
    const exited = new Promise((done) => {
      child.once('error', (error) => { spawnError = error; done(1); });
      child.once('exit', (code) => done(code ?? 1));
    });
    const deadline = this.now() + timeout;
    let ready = false;
    try {
      while (true) {
        if (spawnError) { record.phase = 'failed'; await this.save(record); throw spawnError; }
        const current = await this.processes();
        if (!record.processes.length && child.pid) {
          const root = current.find((item) => item.pid === child.pid);
          if (root) record.processes.push(processIdentity(root));
        }
        record.processes = retainProcessTree(record.processes, current);
        const endpoint = await this.endpoint(record.token);
        if (endpoint) {
          const status = await this.control(endpoint, 'status');
          const main = current.find((item) => item.pid === status.pid);
          if (main && !record.processes.some((item) => item.pid === main.pid && item.created === main.created)) record.processes.push(processIdentity(main));
          record.processes = retainProcessTree(record.processes, current);
          if (status.status === 'failed') throw new Error('ImageQueue reported a startup failure. See its recovery window.');
          if (status.status === 'ready' && main) {
            record.phase = 'ready';
            await this.save(record);
            ready = true;
            return { token: record.token, exited };
          }
        }
        await this.save(record);
        if (this.now() >= deadline) throw new Error('The selected ImageQueue generation did not become ready. An independently opened instance or an older build may be active. Quit it normally, or use rebuild to create the current launcher-aware package.');
        await this.sleep(100);
      }
    } finally { if (!development || !ready) child.unref(); }
  }
}

export async function assertEndpointAvailable(host = RENDERER_HOST, port = RENDERER_PORT) {
  await new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', (error) => reject(new Error(`Cannot bind ${host}:${port}: ${error.code ?? error.message}. The unknown listener was left running.`)));
    probe.listen({ host, port, exclusive: true }, () => probe.close((error) => error ? reject(error) : done()));
  });
}
