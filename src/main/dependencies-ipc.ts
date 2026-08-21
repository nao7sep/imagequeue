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

type DependencyOperation = 'check' | 'cli' | 'recommendations'

const operationControllers = new Map<number, Map<DependencyOperation, AbortController>>()

async function runCancellable<T>(
  senderId: number,
  operation: DependencyOperation,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  let senderOperations = operationControllers.get(senderId)
  if (!senderOperations) {
    senderOperations = new Map()
    operationControllers.set(senderId, senderOperations)
  }
  if (senderOperations.has(operation)) {
    throw new Error(`Dependency ${operation} operation is already running`)
  }
  const controller = new AbortController()
  senderOperations.set(operation, controller)
  try {
    return await run(controller.signal)
  } finally {
    if (senderOperations.get(operation) === controller) senderOperations.delete(operation)
    if (senderOperations.size === 0) operationControllers.delete(senderId)
  }
}

function cancelOperations(senderId: number): void {
  const operations = operationControllers.get(senderId)
  if (!operations) return
  for (const controller of operations.values()) {
    controller.abort(new Error('Dependency operation cancelled'))
  }
}

export function registerDependenciesIpc(): void {
  handle('dependencies:getState', () => getDependenciesState())

  handle('dependencies:check', (event) =>
    runCancellable(event.sender.id, 'check', (signal) => checkAllDependencies(signal))
  )

  handle('dependencies:installCli', (event) =>
    runCancellable(event.sender.id, 'cli', (signal) =>
      installOrUpdateCli((progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('dependencies:progress', progress)
      }, signal)
    )
  )

  handle('dependencies:downloadRecommendations', (event) =>
    runCancellable(event.sender.id, 'recommendations', async (signal) => {
      await downloadLatestRecommendations(signal)
      return getDependenciesState()
    })
  )

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

  handle('dependencies:cancelOperations', (event) => {
    cancelOperations(event.sender.id)
  })
}
