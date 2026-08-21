// Resolving the latest draw-things-cli release from GitHub: the newest release
// tag, the `draw-things-cli` asset's download URL, and its SHA-256 — which the
// GitHub API exposes per asset as a `digest` ("sha256:…"). That published digest
// is the integrity reference (Level 1): the app verifies the download against it,
// with no hash pinned in source.

import { log, serializeError } from '../logger'
import { fetchBytes, RELEASE_METADATA_LIMITS } from './download'

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/drawthingsai/draw-things-community/releases/latest'
const CLI_ASSET_NAME = 'draw-things-cli'

export interface CliRelease {
  tag: string
  assetUrl: string
  // Lowercase hex SHA-256 from the asset's API `digest`, or null when the API
  // omits it (older assets) — the caller treats a missing digest as "cannot
  // verify" and refuses to install rather than trusting an unverified binary.
  sha256: string | null
}

interface GithubAsset {
  name?: string
  browser_download_url?: string
  digest?: string
}

interface GithubRelease {
  tag_name?: string
  assets?: GithubAsset[]
}

// The latest release barely moves within a session and GitHub's unauthenticated
// API is rate-limited (60/hr), so resolve it at most once per process.
// `undefined` = not yet fetched; `null` = fetched but unavailable (kept, so a
// transient failure isn't retried on every panel render).
let cache: CliRelease | null | undefined

async function fetchReleaseJson(signal?: AbortSignal): Promise<GithubRelease | null> {
  try {
    const bytes = await fetchBytes(
      LATEST_RELEASE_URL,
      RELEASE_METADATA_LIMITS,
      signal,
      { 'User-Agent': 'ImageQueue', Accept: 'application/vnd.github+json' }
    )
    return JSON.parse(bytes.toString('utf8')) as GithubRelease
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    log('warn', 'draw-things-cli release lookup failed', { error: serializeError(error) })
    return null
  }
}

/** Parse a release payload into the CLI asset's tag/url/sha256, or null when the
 * payload lacks a tag or the `draw-things-cli` asset. Pure, for unit testing. */
export function parseCliRelease(release: GithubRelease | null): CliRelease | null {
  if (!release?.tag_name) return null
  const asset = release.assets?.find((a) => a.name === CLI_ASSET_NAME)
  if (!asset?.browser_download_url) return null
  const digest = asset.digest && asset.digest.startsWith('sha256:')
    ? asset.digest.slice('sha256:'.length).toLowerCase()
    : null
  return { tag: release.tag_name, assetUrl: asset.browser_download_url, sha256: digest }
}

/** Resolve the latest CLI release. Cached per process; pass `force` for an
 * explicit user-initiated check or install, which re-fetches and refreshes the
 * cache so a release published mid-session is seen. */
export async function resolveLatestCliRelease(
  force = false,
  signal?: AbortSignal
): Promise<CliRelease | null> {
  if (force || cache === undefined) {
    const release = parseCliRelease(await fetchReleaseJson(signal))
    signal?.throwIfAborted()
    cache = release
  }
  return cache
}
