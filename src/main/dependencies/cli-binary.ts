// The app-owned draw-things-cli binary: presence, the install pipeline, and the
// sidecar that records which release it is. The CLI prints `dev` for --version in
// every build, so the installed version is the release tag recorded here at
// download time — there is no other way to know it.
//
// Install is verify-once-at-acquisition: download to temp/, verify the SHA-256
// against the release's published digest, confirm the slice runs native arm64,
// then atomically move it into bin/. A failure at any step leaves no partial
// artifact and throws a clean error; nothing is verified again on later use.

import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { log, serializeError } from '../logger'
import { syncDirectory, syncFile, writeJsonAtomic } from '../utils/atomic-write'
import { getBinDir, getCliBinaryPath, getCliMetaPath, allocateTempPath, discardTempPath } from './paths'
import { downloadToFile, sha256File, type DownloadProgress } from './download'
import type { CliRelease } from './cli-release'
import { isCliReleaseTag } from './cli-version'
import type { DependencyProgress } from '../../shared/types'

const execFileAsync = promisify(execFile)

interface CliMeta {
  tag: string
  sha256: string
  installedAt: string
  /** Device/inode identity of the verified binary this sidecar describes. */
  binaryId?: string
}

function cliBinaryId(): string {
  const stat = fs.statSync(getCliBinaryPath(), { bigint: true })
  return `${stat.dev}:${stat.ino}`
}

function readCliMeta(): CliMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(getCliMetaPath(), 'utf8')) as Partial<CliMeta>
    if (typeof meta.tag !== 'string' || !isCliReleaseTag(meta.tag)) return null
    if (typeof meta.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(meta.sha256)) return null
    if (typeof meta.installedAt !== 'string') return null
    if (meta.binaryId !== undefined && typeof meta.binaryId !== 'string') return null
    return meta as CliMeta
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
    return meta.binaryId === undefined || meta.binaryId === cliBinaryId() ? meta.tag : null
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

/** Publish verified CLI bytes and their release identity. The prior sidecar is
 * removed before the binary commit so a post-publish failure can only leave the
 * installed version unknown, never falsely identified as an older release. */
export function publishCliBinary(
  tempPath: string,
  tag: string,
  sha256: string
): void {
  fs.mkdirSync(getBinDir(), { recursive: true })
  const priorMeta = readCliMeta()
  if (isCliInstalled()) {
    // Bind a legacy sidecar to the still-current binary before replacement. If
    // publication fails, that pair remains valid; if it succeeds and the new
    // sidecar fails, the old identity cannot match the new binary.
    if (priorMeta && priorMeta.binaryId === undefined) {
      writeJsonAtomic(getCliMetaPath(), { ...priorMeta, binaryId: cliBinaryId() }, false)
    }
  } else {
    // An orphan sidecar has no artifact to preserve and must not label the first
    // binary published into this location.
    fs.rmSync(getCliMetaPath(), { force: true })
    syncDirectory(getBinDir())
  }
  fs.renameSync(tempPath, getCliBinaryPath())
  syncDirectory(getBinDir())
  const meta: CliMeta = {
    tag,
    sha256,
    installedAt: new Date().toISOString(),
    binaryId: cliBinaryId(),
  }
  // not recorded: draw-things-cli.json is a sidecar colocated in the binary-bearing bin/ directory,
  // describing the re-fetchable CLI binary it sits beside — it is meaningless without that binary
  // (which is excluded as a re-fetchable binary) and is regenerated on the next install, so it rides
  // along into exclusion rather than being recorded orphaned (data-backup conventions: "Anything
  // colocated in a binary-bearing directory").
  writeJsonAtomic(getCliMetaPath(), meta, false)
}

/**
 * Download, verify, arch-gate, and install the given release into bin/, recording
 * its tag. Reports progress while the body streams. Throws (leaving no partial
 * artifact) when the release has no published digest, the hash mismatches, the
 * binary is not native arm64, or any I/O step fails.
 */
export async function installCliRelease(
  release: CliRelease,
  onProgress?: (progress: DependencyProgress) => void,
  signal?: AbortSignal
): Promise<void> {
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
    publishCliBinary(tempPath, release.tag, release.sha256)
    log('info', 'draw-things-cli installed', { tag: release.tag })
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
