import { serializeError } from '../../../shared/serialize-error'

export type FailureOperation =
  | 'settings-save'
  | 'sessions-load' | 'session-resume' | 'session-create' | 'session-delete' | 'session-folder'
  | 'concepts-load' | 'concept-details-load' | 'concepts-change'
  | 'elaborators-load' | 'elaborators-change'
  | 'drawthings-models-load' | 'drawthings-cli-load' | 'drawthings-catalog-load'
  | 'drawthings-download' | 'drawthings-browse' | 'drawthings-import'
  | 'advanced-elaborators-load' | 'advanced-models-load' | 'advanced-elaborate' | 'advanced-queue'
  | 'elaboration-defaults-load' | 'elaboration-save'
  | 'dependencies-load' | 'dependencies-change' | 'dependencies-cancel'

const COPY: Record<FailureOperation, string> = {
  'settings-save': 'Settings could not be saved. Nothing was changed; try again.',
  'sessions-load': 'Sessions could not be loaded. Close this window and try again.',
  'session-resume': 'This session could not be resumed. The current queue is unchanged; try again.',
  'session-create': 'A new session could not be started. The current session is unchanged; try again.',
  'session-delete': 'This session could not be deleted. It remains in ImageQueue; try again.',
  'session-folder': 'This session folder could not be opened. Check that it is still available.',
  'concepts-load': 'Concepts could not be loaded. Close this window and try again.',
  'concept-details-load': 'The selected concept details could not be loaded. Select the facet again to retry.',
  'concepts-change': 'The concept library could not be changed. Nothing was deleted; try again.',
  'elaborators-load': 'Elaborators could not be loaded. Close this window and try again.',
  'elaborators-change': 'The elaborator change could not be saved. Nothing was changed; try again.',
  'drawthings-models-load': 'Downloaded Draw Things models could not be loaded. Try refreshing them.',
  'drawthings-cli-load': 'Draw Things CLI status could not be loaded. Try again.',
  'drawthings-catalog-load': 'Available Draw Things models could not be loaded. Try again.',
  'drawthings-download': 'The model download could not be started. Nothing was added; try again.',
  'drawthings-browse': 'A model file could not be selected. The current path is unchanged; try again.',
  'drawthings-import': 'The model import could not be started. The selected path is unchanged; try again.',
  'advanced-elaborators-load': 'Elaborators could not be loaded. Close Advanced Prompting and try again.',
  'advanced-models-load': 'Draw Things models could not be loaded. Close Advanced Prompting and try again.',
  'advanced-elaborate': 'The prompt could not be elaborated. Your current prompt is unchanged; try again.',
  'advanced-queue': 'The tasks could not be queued. Nothing was added; try again.',
  'elaboration-defaults-load': 'The shipped elaboration defaults could not be loaded. Your settings are unchanged.',
  'elaboration-save': 'Elaboration settings could not be saved. Nothing was changed; try again.',
  'dependencies-load': 'Managed tools could not be checked. Close this window and try again.',
  'dependencies-change': 'The managed-tool operation could not be completed. The previous state is still shown; try again.',
  'dependencies-cancel': 'The managed-tool operation could not be stopped. It may still be running.',
}

/** Arbitrary renderer/IPC exceptions are diagnostic-only; callers render only this authored copy. */
export function presentFailure(operation: FailureOperation, error: unknown): string {
  try {
    const logging = window.electronAPI.appLog?.('error', 'Renderer operation failed', {
      operation,
      error: serializeError(error),
    })
    void logging?.catch((logError) => console.error('Failed to record a renderer operation diagnostic', logError))
  } catch (logError) {
    console.error('Failed to record a renderer operation diagnostic', logError)
  }
  return COPY[operation]
}
