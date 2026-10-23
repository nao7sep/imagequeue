import { access, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function packagedExecutable(output, platform = process.platform) {
  if (platform === 'win32') return join(output, 'win-unpacked', 'ImageQueue.exe');
  const directories = await readdir(output);
  // The build configuration produces one arm64 macOS app. Do not choose an
  // arbitrary old bundle merely because it happens to appear first.
  const folder = directories.includes('mac-arm64') ? 'mac-arm64' : 'mac';
  return join(output, folder, 'ImageQueue.app', 'Contents', 'MacOS', 'ImageQueue');
}

export async function validatePackage(output, platform = process.platform) {
  const executable = await packagedExecutable(output, platform);
  const resources = platform === 'win32' ? join(output, 'win-unpacked', 'resources')
    : join(executable, '..', '..', 'Resources');
  for (const file of [executable, join(resources, 'app.asar')]) {
    const info = await stat(file);
    if (!info.isFile() || !info.size) throw new Error(`The packaged app is incomplete: ${file}`);
  }
  await access(executable, platform === 'win32' ? constants.R_OK : constants.X_OK);
  return executable;
}

/** Candidate and previous package share a volume. A publication failure restores
 * the previous runnable directory; a failed restore leaves its named backup. */
export async function publishPackage(candidate, output, move = rename) {
  const previous = `${output}.previous-${randomUUID()}`;
  let hadPrevious = false;
  try { await move(output, previous); hadPrevious = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await move(candidate, output); }
  catch (error) {
    if (hadPrevious) {
      try { await move(previous, output); }
      catch (restore) { throw new AggregateError([error, restore], `Package publication failed. The previous app remains at ${previous}.`); }
    }
    throw error;
  }
  if (hadPrevious) await rm(previous, { recursive: true, force: true });
}

export async function buildPackage(root, run, platform = process.platform) {
  const candidate = await mkdtemp(join(root, '.launcher-build-'));
  try {
    await rm(join(root, 'out'), { recursive: true, force: true });
    await run('npm', ['run', 'build']);
    await run(process.execPath, [join(root, 'node_modules', 'electron-builder', 'cli.js'), '--dir', '--publish', 'never', `--config.directories.output=${candidate}`]);
    await validatePackage(candidate, platform);
    await publishPackage(candidate, join(root, 'dist'));
  } finally { await rm(candidate, { recursive: true, force: true }); }
}
