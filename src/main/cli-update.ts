// Draw Things CLI update detection.
//
// The CLI is a user-installed dependency we don't deliver (GPL-3.0, ~170 MB,
// shares the user's Draw Things model directory), so we can't and shouldn't
// auto-update it. We can, however, detect when a newer official release exists
// and prompt the user to update it themselves.
//
// The installed version comes from Homebrew, not the binary: `draw-things-cli
// --version` is hardcoded to `dev` in every build (verified across releases), but
// `brew list --versions` reports the real formula version (e.g. `1.20260430.0`).
// So this only works for brew-installed CLIs — the likely common case. A pre-built
// binary on PATH or a `--HEAD` build yields no comparable version, and the check
// stays silent (`unknown`) rather than guessing. The latest version is the newest
// GitHub release tag (`v1.YYYYMMDD.N`).

import https from 'https'
import { execFile } from 'child_process'
import { loadConfig } from './config'
import { log, serializeError } from './logger'
import { compareCliVersions, parseBrewListVersion } from './cli-version'
import type { CliUpdateStatus } from '../shared/types'

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/drawthingsai/draw-things-community/releases/latest'

/** The installed version per Homebrew, or null when draw-things-cli isn't a
 * brew-managed formula (brew absent, installed another way, or a `--HEAD` build).
 * Reads the local cellar — no network, and not blocked by the untrusted-tap
 * restriction that loading the formula would hit. */
function brewInstalledVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('brew', ['list', '--versions', 'draw-things-cli'], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      resolve(parseBrewListVersion(stdout))
    })
  })
}

// Fetched at most once per process: the latest release barely moves within a
// session, and GitHub's unauthenticated API is rate-limited (60/hr). `undefined`
// means "not yet fetched"; `null` means "fetched but unavailable" (kept, so a
// transient failure isn't retried every time the panel renders).
let latestVersionCache: string | null | undefined

function fetchLatestCliVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const request = https.get(
      LATEST_RELEASE_URL,
      {
        timeout: 10000,
        // GitHub's API rejects requests without a User-Agent.
        headers: { 'User-Agent': 'ImageQueue', Accept: 'application/vnd.github+json' },
      },
      (response) => {
        if ((response.statusCode ?? 0) !== 200) {
          response.resume()
          log('warn', 'draw-things-cli latest-release check failed', { status: response.statusCode })
          resolve(null)
          return
        }
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          try {
            const tag = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.tag_name
            resolve(typeof tag === 'string' ? tag : null)
          } catch (err) {
            log('warn', 'draw-things-cli latest-release parse failed', { error: serializeError(err) })
            resolve(null)
          }
        })
      }
    )
    request.on('error', (err) => {
      log('warn', 'draw-things-cli latest-release request failed', { error: serializeError(err) })
      resolve(null)
    })
    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
  })
}

/**
 * Detect whether a newer Draw Things CLI release is available. Gated by the
 * `check_cli_updates` setting, and only meaningful for a brew-installed CLI.
 * Never throws — a disabled check, a non-brew install, or a network failure all
 * resolve to `unknown`.
 */
export async function checkCliUpdate(): Promise<CliUpdateStatus> {
  if (!loadConfig().image_backends.drawthings.check_cli_updates) {
    return { installedVersion: null, latestVersion: null, status: 'unknown' }
  }
  const installedVersion = await brewInstalledVersion()
  if (!installedVersion) {
    return { installedVersion: null, latestVersion: null, status: 'unknown' }
  }
  if (latestVersionCache === undefined) {
    latestVersionCache = await fetchLatestCliVersion()
  }
  const latestVersion = latestVersionCache
  return {
    installedVersion,
    latestVersion,
    status: compareCliVersions(installedVersion, latestVersion),
  }
}
