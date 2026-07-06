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
import { writeJsonAtomic } from '../utils/atomic-write'
import { getBinDir, getCliBinaryPath, getCliMetaPath, allocateTempPath, discardTempPath } from './paths'
import { downloadToFile, sha256File, type DownloadProgress } from './download'
import type { CliRelease } from './cli-release'
import type { DependencyProgress } from '../../shared/types'

const execFileAsync = promisify(execFile)

interface CliMeta {
  tag: string
  sha256: string
  installedAt: string
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
    const meta = JSON.parse(fs.readFileSync(getCliMetaPath(), 'utf8')) as Partial<CliMeta>
    return typeof meta.tag === 'string' ? meta.tag : null
  } catch {
    return null
  }
}

/** Whether the Mach-O at `filePath` includes an arm64 slice. A universal binary
 * passes; an x86_64-only one fails (the fleet is Apple-Silicon-native, no Rosetta).
 * A `lipo` failure (not a Mach-O, tool missing) is treated as failing the gate. */
export async function hasArm64Slice(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('lipo', ['-archs', filePath], { timeout: 5_000 })
    return stdout.trim().split(/\s+/).includes('arm64')
  } catch (err) {
    log('warn', 'lipo arch check failed', { filePath, error: serializeError(err) })
    return false
  }
}

/**
 * Download, verify, arch-gate, and install the given release into bin/, recording
 * its tag. Reports progress while the body streams. Throws (leaving no partial
 * artifact) when the release has no published digest, the hash mismatches, the
 * binary is not native arm64, or any I/O step fails.
 */
export async function installCliRelease(
  release: CliRelease,
  onProgress?: (progress: DependencyProgress) => void
): Promise<void> {
  if (!release.sha256) {
    throw new Error('Release asset has no published checksum; refusing to install unverified binary')
  }

  const tempPath = allocateTempPath(getCliBinaryPath())
  try {
    await downloadToFile(release.assetUrl, tempPath, (p: DownloadProgress) =>
      onProgress?.({ phase: 'downloading', downloadedBytes: p.downloadedBytes, totalBytes: p.totalBytes })
    )

    onProgress?.({ phase: 'verifying', downloadedBytes: 0, totalBytes: null })
    const actual = await sha256File(tempPath)
    if (actual !== release.sha256) {
      throw new Error(`Checksum mismatch: expected ${release.sha256}, got ${actual}`)
    }
    if (!(await hasArm64Slice(tempPath))) {
      throw new Error('Downloaded binary is not native arm64; refusing to install')
    }

    onProgress?.({ phase: 'installing', downloadedBytes: 0, totalBytes: null })
    fs.chmodSync(tempPath, 0o755)
    // The file was written by us, not a browser, so it usually carries no
    // quarantine xattr — strip it defensively so Gatekeeper never blocks the
    // ad-hoc-signed binary on first run. A missing attribute is not an error.
    await stripQuarantine(tempPath)

    fs.mkdirSync(getBinDir(), { recursive: true })
    // Write the sidecar first, then publish the binary by atomic rename. The
    // binary is the presence gate (isCliInstalled scans for it), so making it the
    // last commit guarantees a present binary always has its tag recorded — never
    // an untagged binary that reads as "installed-unchecked". A sidecar left
    // without a binary (if the rename then failed) reads as not-installed and is
    // harmless, overwritten on the next install. Same filesystem → atomic replace.
    const meta: CliMeta = { tag: release.tag, sha256: release.sha256, installedAt: new Date().toISOString() }
    // not recorded: draw-things-cli.json is a sidecar colocated in the binary-bearing bin/ directory,
    // describing the re-fetchable CLI binary it sits beside — it is meaningless without that binary
    // (which is excluded as a re-fetchable binary) and is regenerated on the next install, so it rides
    // along into exclusion rather than being recorded orphaned (data-backup conventions: "Anything
    // colocated in a binary-bearing directory").
    writeJsonAtomic(getCliMetaPath(), meta, false)
    fs.renameSync(tempPath, getCliBinaryPath())
    log('info', 'draw-things-cli installed', { tag: release.tag })
  } catch (err) {
    discardTempPath(tempPath)
    throw err
  }
}

async function stripQuarantine(filePath: string): Promise<void> {
  try {
    await execFileAsync('xattr', ['-d', 'com.apple.quarantine', filePath], { timeout: 5_000 })
  } catch {
    /* attribute absent (the normal case) — nothing to strip */
  }
}
