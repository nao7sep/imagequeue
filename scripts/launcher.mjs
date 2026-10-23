// Shared orchestration for the paired macOS/Windows double-click launchers.
// Usage: node scripts/launcher.mjs run-dev | run-built | rebuild
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LauncherRuntime, REPO_ROOT, RENDERER_HOST, RENDERER_PORT, assertEndpointAvailable } from './launcher-runtime.mjs';
import { buildPackage, validatePackage } from './launcher-build.mjs';

const step = (text) => process.stdout.write(`\n==> ${text}\n`);
function run(command, args) {
  return new Promise((done, reject) => {
    // npm.cmd needs the Windows command processor. These npm arguments are
    // authored constants; paths go directly to Node without a shell.
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${command} failed (${signal ?? code}).`)));
  });
}

export async function launch(mode) {
  if (!['run-dev', 'run-built', 'rebuild'].includes(mode)) throw new Error('Expected run-dev, run-built or rebuild.');
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('ImageQueue launchers support macOS and Windows.');
  const runtime = new LauncherRuntime();
  let launched;
  let interrupted = false;
  let stopping;
  const stop = () => {
    interrupted = true;
    if (!launched || stopping) return;
    stopping = runtime.stopIfOwner(launched.token).catch((error) => {
      process.stderr.write(`${error.message}\n`);
    }).finally(() => { stopping = undefined; });
  };
  const checkInterrupt = () => {
    if (interrupted) throw Object.assign(new Error('Launcher interrupted before app startup.'), { exitCode: 130 });
  };
  // Install before any awaited work. An interrupt during installation/build
  // prevents startup after that owned operation settles and releases the lock.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  try {
    await runtime.exclusive(async () => {
      let executable;
      if (mode === 'run-built') {
        try { executable = await validatePackage(join(REPO_ROOT, 'dist')); }
        catch (cause) { throw new Error('No complete packaged ImageQueue app is available. Run rebuild first.', { cause }); }
      }
      step('Requesting ordinary closure of the previous launcher-owned app');
      await runtime.stopCurrent();
      checkInterrupt();
      if (mode !== 'run-built') {
        if (mode === 'run-dev') await assertEndpointAvailable();
        step('Installing dependencies');
        await run('npm', ['install', '--no-audit', '--no-fund']);
        checkInterrupt();
        step('Verifying Electron');
        await run('npm', ['run', 'prepare:electron']);
      }
      checkInterrupt();
      if (mode === 'rebuild') {
        step('Building and validating a clean production package');
        await buildPackage(REPO_ROOT, run);
        executable = await validatePackage(join(REPO_ROOT, 'dist'));
      }
      checkInterrupt();
      if (mode === 'run-dev') {
        step('Starting ImageQueue with live reload');
        launched = await runtime.start(process.execPath, [join(REPO_ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'dev'], { development: true });
        step(`ImageQueue is ready at http://${RENDERER_HOST}:${RENDERER_PORT}`);
      } else {
        const built = (await stat(dirname(executable))).mtime.toLocaleString();
        step(`Launching the packaged ImageQueue app (built: ${built})`);
        launched = await runtime.start(executable, []);
        step('ImageQueue is ready');
      }
    });
    if (interrupted) { stop(); await stopping; }
    if (mode === 'run-dev') {
      // The detached dev group stays alive until ordinary Electron closure makes
      // electron-vite exit; terminal signals never bypass the app's quit owner.
      const code = await launched.exited;
      if (code !== 0) throw new Error(`The development runtime exited with code ${code}.`);
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    process.off('SIGHUP', stop);
    if (stopping) await stopping;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch(process.argv[2]).catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = error.exitCode ?? 1; });
}
