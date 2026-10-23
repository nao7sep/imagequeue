import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog, type WebContents } from 'electron'
import { getDataDir } from './config'
import { writeFileAtomicAsync } from './utils/atomic-write'
import { mainTranslator } from './i18n'
import { waitForStorage } from './utils/storage-wait'

// Only native user consent writes this authority. Config values supplied by a
// renderer are requests, not file grants. Canonical paths prevent a selected
// symlink from subsequently authorizing a different destination.
let saving: Promise<unknown> = Promise.resolve()
function grantFile(): string { return path.join(getDataDir(), 'sound-file-grants.json') }
async function readGrants(): Promise<Set<string>> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(grantFile(), 'utf8'))
    if (!raw || typeof raw !== 'object' || !('formatVersion' in raw) || raw.formatVersion !== 1 || !('paths' in raw) || !Array.isArray(raw.paths)
      || !raw.paths.every((item) => typeof item === 'string' && path.isAbsolute(item))) return new Set()
    return new Set(raw.paths)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return new Set()
    throw error
  }
}
export async function grantPickedSoundFile(file: string): Promise<void> {
  const canonical = await fs.promises.realpath(file)
  const write = saving.catch(() => undefined).then(async () => {
    const grants = await readGrants()
    grants.add(canonical)
    // Re-creatable native consent, not authored settings or a credential.
    await writeFileAtomicAsync(grantFile(), JSON.stringify({ formatVersion: 1, paths: [...grants] }), false)
  })
  saving = write
  await write
}
async function readGrant(file: string): Promise<{ canonical: string; granted: boolean } | null> {
  if (!file) return null
  const canonical = await fs.promises.realpath(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!canonical) return null
  await saving.catch(() => undefined)
  return { canonical, granted: (await readGrants()).has(canonical) }
}

// A timed-out check remains the owner of its filesystem work. Repeated
// notifications for that path share it instead of piling up blocked reads.
const inspections = new Map<string, Promise<{ canonical: string; granted: boolean } | null>>()
function inspectGrant(file: string): Promise<{ canonical: string; granted: boolean } | null> {
  const existing = inspections.get(file)
  if (existing) return existing
  const pending = readGrant(file).finally(() => inspections.delete(file))
  inspections.set(file, pending)
  return pending
}

/** Resource requests may reuse native consent, but cannot open a consent dialog. */
export async function grantedSoundFile(file: string): Promise<string | null> {
  const grant = await waitForStorage(inspectGrant(file))
  return grant?.granted ? grant.canonical : null
}

export async function authorizedSoundFile(file: string, sender: WebContents): Promise<string | null> {
  const grant = await waitForStorage(inspectGrant(file))
  if (!grant) return null
  const { canonical } = grant
  if (grant.granted) return canonical
  const owner = BrowserWindow.fromWebContents(sender)
  const t = mainTranslator().t
  const options: Electron.MessageBoxOptions = {
    type: 'question', message: t('settings.allowSoundFile'), detail: canonical,
    buttons: [t('common.cancel'), t('common.allow')], defaultId: 0, cancelId: 0, noLink: true,
  }
  const answer = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  if (answer.response !== 1) return null
  // Grant exactly the displayed canonical path, not a link retargeted while
  // the native question was open.
  return await waitForStorage((async () => {
    if (await fs.promises.realpath(canonical) !== canonical) return null
    await grantPickedSoundFile(canonical)
    return canonical
  })())
}
