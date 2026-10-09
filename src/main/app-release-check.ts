import { shell } from 'electron'
import { handle } from './ipc-boundary'
import { loadConfig } from './config'
import { readUiState, recordReleaseCheckAttempt } from './state-store'
import { fetchBytes } from './dependencies/download'
import { log, serializeError } from './logger'
import { broadcastPresentation } from './presentation'
import { createAppReleaseCheckOwner } from './app-release-check-owner'

const RELEASE_PAGE = 'https://github.com/nao7sep/imagequeue/releases/latest'

export function startAppReleaseCheck(): void {
  const owner = createAppReleaseCheckOwner({
    enabled: () => loadConfig().general.check_github_releases_at_launch,
    lastAttempt: async () => (await readUiState()).releaseCheckLastAttemptUtc,
    saveAttempt: recordReleaseCheckAttempt,
    installed: __APP_VERSION__,
    fetch: async () => JSON.parse((await fetchBytes(
      'https://api.github.com/repos/nao7sep/imagequeue/releases/latest',
      { maxBytes: 2 * 1024 * 1024, idleTimeoutMs: 10_000, wholeTimeoutMs: 10_000 },
      undefined,
      { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'ImageQueue' },
    )).toString('utf8')) as unknown,
    present: (result) => broadcastPresentation('appRelease:result', result),
    log: (error) => log('warn', 'GitHub app release check failed', { error: serializeError(error) }),
  })
  // The main interface subscribes before announcing readiness; remounts cannot
  // repeat the launch request, and results never need a focus-taking surface.
  handle('appRelease:ready', () => { void owner.check(false) })
  handle('appRelease:check', () => owner.check(true))
  handle('appRelease:view', () => shell.openExternal(RELEASE_PAGE))
}
