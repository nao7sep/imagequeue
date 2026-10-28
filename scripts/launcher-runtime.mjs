/**
 * One ImageQueue runtime per repository, for the launchers of both platforms.
 * The launcher that starts ImageQueue records its process ID and executable
 * under .git; the next launcher asks that process to quit only while it still
 * runs that executable, and stops with a message rather than force-closing it
 * when it stays open. ImageQueue started any other way is left to its
 * single-instance behavior, which brings its window forward instead of opening
 * a second one.
 */
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RENDERER_HOST = '127.0.0.1';
export const RENDERER_PORT = 20641;
const RECORD_FILE = join(REPO_ROOT, '.git', 'launcher-runtime-process');
const windows = process.platform === 'win32';
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

async function powershell(script) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function osascript(script, ...args) {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...args], { encoding: 'utf8' });
  return stdout.trim();
}

function sameExecutable(left, right) {
  return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** The executable a process runs, or "" when no such process exists. */
async function executableOf(pid) {
  if (windows) return powershell(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`);
  // ps shows the path a process was started with, which wrappers can give
  // relatively; lsof names the file it runs.
  try {
    const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'], { encoding: 'utf8' });
    return stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? '';
  } catch (error) {
    if (error?.code === 1) return ''; // lsof lists nothing for an ended process
    throw error;
  }
}

async function record(pid, executable) {
  await writeFile(RECORD_FILE, `${pid}\n${executable}\n`, 'utf8');
}

/** The recorded process ID, returned only while that process still runs the recorded executable. */
async function recordedPid() {
  let text;
  try {
    text = await readFile(RECORD_FILE, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
  const [pidText, executable] = text.split(/\r?\n/);
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0 || !executable) return undefined;
  return sameExecutable(await executableOf(pid), executable) ? pid : undefined;
}

/** Ask the process to quit as a user would, so it can still finish or ask about running work. */
async function requestClose(pid) {
  if (windows) {
    await powershell(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $null = $p.CloseMainWindow() }`);
    return;
  }
  await osascript(`ObjC.import('AppKit');
function run(args) {
  var application = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(args[0]));
  if (application) application.terminate;
}`, String(pid));
}

/** Ask the recorded runtime to quit; with onlyPid, only while that is the recorded one. */
export async function stopRecorded(onlyPid) {
  const pid = await recordedPid();
  if (pid === undefined || (onlyPid !== undefined && pid !== onlyPid)) return;
  process.stdout.write(`Asking the running ImageQueue (pid ${pid}) to quit.\n`);
  await requestClose(pid);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await recordedPid() !== pid) return;
    await delay(100);
  }
  throw new Error('ImageQueue is still open, perhaps finishing or asking about running work. Close it, then run this launcher again.');
}

const singleInstanceNote = 'If ImageQueue was already running outside these launchers, its window is brought forward instead.\n';

/** Open a new instance of the bundle through Launch Services, which gives it its bundle identity. */
export async function launchBundle(bundle) {
  const pid = Number(await osascript(`ObjC.import('AppKit');
function run(args) {
  var application = $.NSWorkspace.sharedWorkspace.launchApplicationAtURLOptionsConfigurationError(
    $.NSURL.fileURLWithPath(args[0]), $.NSWorkspaceLaunchNewInstance, $({}), null);
  return application.isNil() ? '' : String(application.processIdentifier);
}`, resolve(bundle)));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('ImageQueue could not be opened.');
  await record(pid, await executableOf(pid));
  process.stdout.write(singleInstanceNote);
}

export async function launchExecutable(executable) {
  const child = spawn(resolve(executable), [], { detached: true, stdio: 'ignore' });
  await once(child, 'spawn');
  child.unref();
  await record(child.pid, resolve(executable));
  process.stdout.write(singleInstanceNote);
}

async function listProcesses() {
  if (!windows) {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return stdout.split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
      .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]), executable: match[3].trim() }));
  }
  const decoded = JSON.parse(await powershell(
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress',
  ) || '[]');
  return (Array.isArray(decoded) ? decoded : [decoded]).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    executable: row.ExecutablePath ?? '',
  }));
}

/**
 * Record the app process that the wrapper (electron-vite) starts, once it
 * appears: the topmost descendant running the executable, since Electron's own
 * child processes can share it. Fails when the wrapper ends first, as it does
 * when the build fails. Returns the recorded process ID.
 */
export async function recordWrapped(wrapperPid, executable) {
  const expected = resolve(executable);
  for (;;) {
    const processes = await listProcesses();
    if (!processes.some((item) => item.pid === wrapperPid)) {
      throw new Error('The ImageQueue development runtime ended before the app started.');
    }
    const descendants = new Set([wrapperPid]);
    for (let grown = true; grown;) {
      grown = false;
      for (const item of processes) {
        if (descendants.has(item.parentPid) && !descendants.has(item.pid)) {
          descendants.add(item.pid);
          grown = true;
        }
      }
    }
    const candidates = processes.filter((item) => item.pid !== wrapperPid && descendants.has(item.pid)
      && sameExecutable(basename(item.executable), basename(expected)));
    const matches = [];
    for (const item of candidates) {
      const running = windows ? item.executable : await executableOf(item.pid);
      if (sameExecutable(running, expected)) matches.push({ ...item, executable: running });
    }
    const app = matches.find((item) => !matches.some((other) => other.pid === item.parentPid));
    if (app) {
      await record(app.pid, app.executable);
      return app.pid;
    }
    await delay(200);
  }
}

export async function assertEndpointAvailable(host = RENDERER_HOST, port = RENDERER_PORT) {
  await new Promise((resolveProbe, rejectProbe) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => {
      rejectProbe(new Error(
        `Cannot bind ${host}:${port}: ${error.code ?? error.message}. The listener was left running because its app identity is unknown.`,
      ));
    });
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close((error) => error ? rejectProbe(error) : resolveProbe());
    });
  });
}

export async function waitForHttp(url, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`${url} did not become ready within ${timeoutMilliseconds} ms (${lastError}).`);
}
