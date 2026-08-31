import { BrowserWindow } from 'electron'
import {
  SESSION_DRAFT_PERSISTENCE_ERROR,
  type SessionDraftPersistenceState,
} from '../../shared/electron-api'

let persistenceState: SessionDraftPersistenceState = { status: 'saved' }

function broadcast(state: SessionDraftPersistenceState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('session:draftPersistenceState', state)
  }
}

export function getDraftPersistenceState(): SessionDraftPersistenceState {
  return persistenceState
}

// One failure episode produces one renderer announcement, even if the disk
// remains unavailable while the user keeps typing. A later successful draft
// flush ends the episode and lets the next distinct failure announce itself.
export function markDraftPersistenceFailed(): void {
  if (persistenceState.status === 'failed') return
  persistenceState = {
    status: 'failed',
    message: SESSION_DRAFT_PERSISTENCE_ERROR,
  }
  broadcast(persistenceState)
}

export function markDraftPersistenceSaved(): void {
  if (persistenceState.status === 'saved') return
  persistenceState = { status: 'saved' }
  broadcast(persistenceState)
}
