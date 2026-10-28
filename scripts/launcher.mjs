// Shared steps for the paired macOS/Windows double-click launchers: install,
// build, stop the previous launcher-started app and launch.
// Usage: node scripts/launcher.mjs run-dev | run-built | rebuild
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT, RENDERER_HOST, RENDERER_PORT, assertEndpointAvailable, launchBundle, launchExecutable,
  recordWrapped, stopRecorded, waitForHttp,
} from './launcher-runtime.mjs';
import { buildPackage, validatePackage } from './launcher-build.mjs';

const windows = process.platform === 'win32';
const step = (text) => process.stdout.write(`\n==> ${text}\n`);
function run(command, args) {
  return new Promise((done, reject) => {
    // npm.cmd needs the Windows command processor. These npm arguments are
    // authored constants; paths go directly to Node without a shell.
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: windows && command === 'npm' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${command} failed (${signal ?? code}).`)));
  });
}

async function launchPackaged(executable) {
  const built = (await stat(dirname(executable))).mtime.toLocaleString();
  step(`Launching the packaged ImageQueue app (built: ${built})`);
  if (windows) await launchExecutable(executable);
  else await launchBundle(resolve(executable, '..', '..', '..'));
}

// The dev runtime runs in its own process group, so a terminal interrupt
// reaches only this launcher, which then asks the app it started to quit.
async function runDev() {
  const child = spawn(process.execPath, [join(REPO_ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'dev'], {
    cwd: REPO_ROOT, stdio: 'inherit', detached: !windows,
  });
  const exited = once(child, 'exit');
  let appPid;
  const stop = () => {
    // Before the app has started there is nothing to close; end the build.
    if (appPid === undefined) { child.kill(); return; }
    void stopRecorded(appPid).catch((error) => process.stderr.write(`${error.message}\n`));
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
  try {
    const url = `http://${RENDERER_HOST}:${RENDERER_PORT}`;
    await waitForHttp(url, 60_000);
    const electron = windows
      ? join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
      : join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
    appPid = await recordWrapped(child.pid, electron);
    step(`ImageQueue is ready at ${url}`);
    const [code] = await exited;
    if (code !== 0) throw new Error(`The development runtime exited with code ${code}.`);
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop);
  }
}

export async function launch(mode) {
  if (!['run-dev', 'run-built', 'rebuild'].includes(mode)) throw new Error('Expected run-dev, run-built or rebuild.');
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('ImageQueue launchers support macOS and Windows.');
  if (mode === 'run-built') {
    let executable;
    try { executable = await validatePackage(join(REPO_ROOT, 'dist')); }
    catch (cause) { throw new Error('No complete packaged ImageQueue app is available. Run rebuild first.', { cause }); }
    step('Replacing any launcher-started ImageQueue');
    await stopRecorded();
    await launchPackaged(executable);
    return;
  }
  step('Replacing any launcher-started ImageQueue');
  await stopRecorded();
  if (mode === 'run-dev') await assertEndpointAvailable();
  step('Installing dependencies');
  await run('npm', ['install', '--no-audit', '--no-fund']);
  step('Verifying Electron');
  await run('npm', ['run', 'prepare:electron']);
  if (mode === 'run-dev') {
    step('Starting ImageQueue with live reload');
    await runDev();
    return;
  }
  step('Building and validating a clean production package');
  await buildPackage(REPO_ROOT, run);
  await launchPackaged(await validatePackage(join(REPO_ROOT, 'dist')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch(process.argv[2]).catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
