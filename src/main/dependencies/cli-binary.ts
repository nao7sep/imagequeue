// The app-owned draw-things-cli binary: presence, the install pipeline, and the
// sidecar that records which release it is. The CLI prints `dev` for --version in
// every build, so the installed version is the release tag recorded here at
// download time — there is no other way to know it.
//
// Install is verify-once-at-acquisition: download to temp/, verify the SHA-256
// against the release's published digest, confirm the slice runs native arm64,
// then atomically move it into bin/. Pre-publication failures reject; once the
// binary is published, secondary persistence failures return warnings. Nothing
// is verified again on later use.

import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { log, serializeError } from '../logger'
import { writeJsonAtomic } from '../utils/atomic-write'
import { syncDirectory, syncFile } from '../utils/fsync'
import { getBinDir, getCliBinaryPath, getCliMetaPath, allocateTempPath, discardTempPath } from './paths'
import { downloadToFile, sha256File, type DownloadProgress } from './download'
import type { CliRelease } from './cli-release'
import { isCliReleaseTag } from './cli-version'
import type { CliInstallWarning, DependencyProgress } from '../../shared/types'
import { FORMAT_VERSIONS, FORMAT_VERSION_KEY, markFormat } from '../store-format'

const execFileAsync = promisify(execFile)

// What the app reads back: the release and the binary it labels. The download
// is verified against its published checksum before it is published, so the
// sidecar keeps no hash or install time; ones an earlier version wrote are
// ignored.
interface CliMeta {
  tag: string
  /** Inode of the verified binary this sidecar describes. */
  binaryId: string
}

// The binary's identity is its inode alone. macOS numbers devices as volumes
// mount, so a device number can change across restarts and OS updates while
// the file stays the same, which left every installed version unreadable. An
// install renames a fresh file into place, so a new binary always has a new
// inode.
function cliBinaryId(): string {
  return String(fs.statSync(getCliBinaryPath(), { bigint: true }).ino)
}

// A cache of the installed binary's identity: its format version is written but
// never checked, and any field that does not fit reads as an unknown version.
// Install and Update replace it whatever build wrote it, since the binary it
// describes is re-fetchable (store-recovery-conventions).
function readCliMeta(): CliMeta | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(getCliMetaPath(), 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const { [FORMAT_VERSION_KEY]: _formatVersion, ...meta } = raw as Partial<CliMeta> & Record<string, unknown>
    if (typeof meta.tag !== 'string' || !isCliReleaseTag(meta.tag)) return null
    if (typeof meta.binaryId !== 'string') return null
    return { tag: meta.tag, binaryId: meta.binaryId }
  } catch {
    return null
  }
}

export function isCliInstalled(): boolean {
  try {
    return fs.statSync(getCliBinaryPath()).isFile()
  } catch {
    return false
  }
}

/** The release tag recorded when the binary was installed, or null if the binary
 * or its sidecar is absent/unreadable. This is the installed version. */
export function readInstalledCliTag(): string | null {
  if (!isCliInstalled()) return null
  try {
    const meta = readCliMeta()
    if (!meta) return null
    return meta.binaryId === cliBinaryId() ? meta.tag : null
  } catch {
    return null
  }
}

/** Whether the Mach-O at `filePath` includes an arm64 slice. A universal binary
 * passes; an x86_64-only one fails (the fleet is Apple-Silicon-native, no Rosetta).
 * A `lipo` failure (not a Mach-O, tool missing) is treated as failing the gate. */
export async function hasArm64Slice(filePath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('lipo', ['-archs', filePath], { timeout: 5_000, signal })
    return stdout.trim().split(/\s+/).includes('arm64')
  } catch (err) {
    if (signal?.aborted) throw signal.reason
    log('warn', 'lipo arch check failed', { filePath, error: serializeError(err) })
    return false
  }
}

/** Publish verified CLI bytes and their release identity. A prior sidecar names
 * the binary it describes, so a failure after the binary commit can only leave
 * the installed version unknown, never falsely identified as an older release. */
export function publishCliBinary(tempPath: string, tag: string): CliInstallWarning[] {
  fs.mkdirSync(getBinDir(), { recursive: true })
  if (!isCliInstalled()) {
    // An orphan sidecar has no artifact to preserve and must not label the first
    // binary published into this location.
    fs.rmSync(getCliMetaPath(), { force: true })
    syncDirectory(getBinDir())
  }
  fs.renameSync(tempPath, getCliBinaryPath())
  const warnings: CliInstallWarning[] = []
  try { syncDirectory(getBinDir()) } catch (error) {
    warnings.push('sync-incomplete')
    log('warn', 'Draw Things CLI was published but directory sync failed', { error: serializeError(error) })
  }
  try {
    const meta: CliMeta = { tag, binaryId: cliBinaryId() }
    // not recorded: draw-things-cli.json is a sidecar colocated in the binary-bearing bin/ directory,
    // describing the re-fetchable CLI binary it sits beside — it is meaningless without that binary
    // (which is excluded as a re-fetchable binary) and is regenerated on the next install, so it rides
    // along into exclusion rather than being recorded orphaned (data-backup conventions: "Anything
    // colocated in a binary-bearing directory").
    writeJsonAtomic(getCliMetaPath(), markFormat(meta, FORMAT_VERSIONS.cliSidecar), false)
  } catch (error) {
    const warning = readInstalledCliTag() === tag ? 'sync-incomplete' : 'identity-unavailable'
    if (!warnings.includes(warning)) warnings.push(warning)
    log('warn', 'Draw Things CLI was published but identity persistence failed', { error: serializeError(error) })
  }
  return warnings
}

/**
 * Download, verify, arch-gate, and install the given release into bin/, recording
 * its tag. Reports progress while the body streams. Pre-publication failures
 * reject and discard staging. After publication, identity or directory-sync
 * failures retain the installed binary and return secondary warnings.
 */
export async function installCliRelease(
  release: CliRelease,
  onProgress?: (progress: DependencyProgress) => void,
  signal?: AbortSignal
): Promise<CliInstallWarning[]> {
  if (!release.sha256) {
    throw new Error('Release asset has no published checksum; refusing to install unverified binary')
  }

  const tempPath = allocateTempPath(getCliBinaryPath())
  try {
    await downloadToFile(
      release.assetUrl,
      tempPath,
      (p: DownloadProgress) =>
        onProgress?.({ phase: 'downloading', downloadedBytes: p.downloadedBytes, totalBytes: p.totalBytes }),
      signal
    )

    signal?.throwIfAborted()
    onProgress?.({ phase: 'verifying', downloadedBytes: 0, totalBytes: null })
    const actual = await sha256File(tempPath, signal)
    if (actual !== release.sha256) {
      throw new Error(`Checksum mismatch: expected ${release.sha256}, got ${actual}`)
    }
    if (!(await hasArm64Slice(tempPath, signal))) {
      throw new Error('Downloaded binary is not native arm64; refusing to install')
    }

    onProgress?.({ phase: 'installing', downloadedBytes: 0, totalBytes: null })
    signal?.throwIfAborted()
    fs.chmodSync(tempPath, 0o755)
    // The file was written by us, not a browser, so it usually carries no
    // quarantine xattr — strip it defensively so Gatekeeper never blocks the
    // ad-hoc-signed binary on first run. A missing attribute is not an error.
    await stripQuarantine(tempPath, signal)
    signal?.throwIfAborted()
    // downloadToFile synced the bytes; sync once more after chmod/xattr so the
    // executable metadata is durable before publication.
    syncFile(tempPath)

    // Invalidate the prior artifact's identity immediately before publication.
    // From this point until the new sidecar lands, either binary reads as
    // version-unknown and remains re-acquirable; the new binary can never inherit
    // the old binary's release tag after a sync or sidecar-write failure.
    signal?.throwIfAborted()
    const warnings = publishCliBinary(tempPath, release.tag)
    log('info', 'draw-things-cli installed', { tag: release.tag })
    return warnings
  } catch (err) {
    discardTempPath(tempPath)
    throw err
  }
}

async function stripQuarantine(filePath: string, signal?: AbortSignal): Promise<void> {
  try {
    await execFileAsync('xattr', ['-d', 'com.apple.quarantine', filePath], { timeout: 5_000, signal })
  } catch {
    if (signal?.aborted) throw signal.reason
    /* attribute absent (the normal case) — nothing to strip */
  }
}
