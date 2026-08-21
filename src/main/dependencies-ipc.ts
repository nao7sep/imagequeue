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
import {
  cancelDependencyOperationsOwnedBy,
  runDependencyOperation,
  type MutableDependency,
} from './dependencies/operations'

function runWindowDependencyOperation<T>(
  owner: Electron.WebContents,
  dependencies: readonly MutableDependency[],
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  return runDependencyOperation(owner, dependencies, run, (cancel) => {
    const ownerDestroyed = (): void => {
      cancel(new Error('Dependency operation cancelled because its window closed'))
    }
    owner.once('destroyed', ownerDestroyed)
    return () => owner.removeListener('destroyed', ownerDestroyed)
  })
}

export function registerDependenciesIpc(): void {
  handle('dependencies:getState', () => getDependenciesState())

  handle('dependencies:check', (event) =>
    runWindowDependencyOperation(event.sender, ['cli', 'recommendations'], (signal) =>
      checkAllDependencies(signal)
    )
  )

  handle('dependencies:installCli', (event) =>
    runWindowDependencyOperation(event.sender, ['cli'], (signal) =>
      installOrUpdateCli((progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('dependencies:progress', progress)
      }, signal)
    )
  )

  handle('dependencies:downloadRecommendations', (event) =>
    runWindowDependencyOperation(event.sender, ['recommendations'], async (signal) => {
      await downloadLatestRecommendations(signal)
      return getDependenciesState()
    })
  )

  handle('dependencies:updateRecommendations', (event) =>
    runWindowDependencyOperation(event.sender, ['recommendations'], async (signal) => {
      signal.throwIfAborted()
      applyPendingRecommendations()
      return getDependenciesState()
    })
  )

  handle('dependencies:setCheckAtLaunch', (_event, value: boolean) => {
    const config = loadConfig()
    config.image_backends.drawthings.check_updates_at_launch = value
    saveConfig(config)
    return getDependenciesState()
  })

  handle('dependencies:cancelOperations', (event) => {
    cancelDependencyOperationsOwnedBy(
      event.sender,
      new Error('Dependency operation cancelled')
    )
  })
}
