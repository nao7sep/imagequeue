import { loadConfig } from './config'
import { checkApiKeysAtLaunch } from './config/api-keys-store'
import { listElaborators } from './elaborators'
import { getAllModelParams } from './model-params'
import { loadBackendParams } from './backend-params'
import { getUiStatePath } from './state-store'
import { getCliMetaPath, getDependenciesStatePath, getRecommendationsTimesPath } from './dependencies/paths'
import { checkCacheAtLaunch, FILE_FORMATS, LaunchStopError, refusedFile, type RefusedFile } from './store-format'

/**
 * Reads every file ImageQueue opens to start, before anything is written
 * (store-recovery-conventions, What a refused file does). The user's settings,
 * secrets and authored stores stop the launch when they cannot be read or a
 * newer version wrote them; a cache stops it only when it is newer, since an
 * unreadable one is rebuilt. Every refused file is named in one stop.
 */
export function checkLaunchFiles(): void {
  const refused: RefusedFile[] = []
  const check = (read: () => unknown): void => {
    try { read() } catch (error) {
      const file = refusedFile(error)
      if (!file) throw error
      refused.push(file)
    }
  }
  check(loadConfig)
  check(listElaborators)
  check(getAllModelParams)
  check(loadBackendParams)
  check(checkApiKeysAtLaunch)
  check(() => checkCacheAtLaunch(getUiStatePath(), FILE_FORMATS.uiState))
  check(() => checkCacheAtLaunch(getDependenciesStatePath(), FILE_FORMATS.dependencies))
  check(() => checkCacheAtLaunch(getCliMetaPath(), FILE_FORMATS.cliSidecar))
  check(() => checkCacheAtLaunch(getRecommendationsTimesPath(), FILE_FORMATS.recommendationsTimes))
  if (refused.length > 0) throw new LaunchStopError(refused)
}
