// IPC for the ephemeral UI-state store (state.json). The renderer hydrates the
// persisted pane width once on mount via state:get and writes it back on a
// splitter drag via state:update; both return the full UiState snapshot.

import { handle } from './ipc-boundary'
import { readUiState, updateUiState } from './state-store'
import type { UiState } from '../shared/ui-state'

export function registerStateIpc(): void {
  handle('state:get', () => readUiState())
  handle('state:update', (_event, patch: Partial<UiState>) => updateUiState(patch))
}
