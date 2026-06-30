// IPC for the managed-dependencies surface (the modal and the pane pointer). All
// state-returning handlers return the full DependenciesState so the renderer
// re-renders from one snapshot after any operation. The CLI install streams
// progress to the requesting window over 'dependencies:progress'.

import { handle } from './ipc-boundary'
import { loadConfig, saveConfig } from './config'
import {
  getDependenciesState,
  checkAllDependencies,
  installOrUpdateCli,
} from './dependencies/service'
import {
  downloadLatestRecommendations,
  applyPendingRecommendations,
} from './recommendations'

export function registerDependenciesIpc(): void {
  handle('dependencies:getState', () => getDependenciesState())

  handle('dependencies:check', () => checkAllDependencies())

  handle('dependencies:installCli', (event) =>
    installOrUpdateCli((progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('dependencies:progress', progress)
    })
  )

  handle('dependencies:downloadRecommendations', async () => {
    await downloadLatestRecommendations()
    return getDependenciesState()
  })

  handle('dependencies:updateRecommendations', () => {
    applyPendingRecommendations()
    return getDependenciesState()
  })

  handle('dependencies:setCheckAtLaunch', (_event, value: boolean) => {
    const config = loadConfig()
    config.image_backends.drawthings.check_updates_at_launch = value
    saveConfig(config)
    return getDependenciesState()
  })
}
