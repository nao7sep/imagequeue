import { BrowserWindow } from 'electron'
import { type DrawThingsParamsPersistenceState } from '../shared/electron-api'

let persistenceState: DrawThingsParamsPersistenceState = { status: 'saved' }

function broadcast(state: DrawThingsParamsPersistenceState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('drawthings:paramsPersistenceState', state)
  }
}

export function getModelParamsPersistenceState(): DrawThingsParamsPersistenceState {
  return persistenceState
}

export function markModelParamsPersistenceFailed(): void {
  if (persistenceState.status === 'failed') return
  persistenceState = { status: 'failed' }
  broadcast(persistenceState)
}

export function markModelParamsPersistenceSaved(): void {
  if (persistenceState.status === 'saved') return
  persistenceState = { status: 'saved' }
  broadcast(persistenceState)
}
