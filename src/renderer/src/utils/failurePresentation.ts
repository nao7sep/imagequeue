import { serializeError } from '../../../shared/serialize-error'
import type { MessageKey } from '../../../shared/i18n/catalogues'

export type FailureOperation =
  | 'settings-save'
  | 'sessions-load' | 'session-resume' | 'session-create' | 'session-delete' | 'session-folder'
  | 'concepts-load' | 'concept-details-load' | 'concepts-change'
  | 'elaborators-load' | 'elaborators-change'
  | 'drawthings-models-load' | 'drawthings-models-poll' | 'drawthings-cli-load' | 'drawthings-catalog-load'
  | 'drawthings-download' | 'drawthings-browse' | 'drawthings-import'
  | 'advanced-elaborators-load' | 'advanced-models-load' | 'advanced-elaborate' | 'advanced-queue'
  | 'elaboration-defaults-load' | 'elaboration-save'
  | 'dependencies-load' | 'dependencies-change' | 'dependencies-cancel'

// Each operation's authored copy is the catalogue entry failure.<operation in
// camel case>, rendered where it is shown.
const COPY: Record<FailureOperation, MessageKey> = {
  'settings-save': 'failure.settingsSave',
  'sessions-load': 'failure.sessionsLoad',
  'session-resume': 'failure.sessionResume',
  'session-create': 'failure.sessionCreate',
  'session-delete': 'failure.sessionDelete',
  'session-folder': 'failure.sessionFolder',
  'concepts-load': 'failure.conceptsLoad',
  'concept-details-load': 'failure.conceptDetailsLoad',
  'concepts-change': 'failure.conceptsChange',
  'elaborators-load': 'failure.elaboratorsLoad',
  'elaborators-change': 'failure.elaboratorsChange',
  'drawthings-models-load': 'failure.drawthingsModelsLoad',
  'drawthings-models-poll': 'failure.drawthingsModelsPoll',
  'drawthings-cli-load': 'failure.drawthingsCliLoad',
  'drawthings-catalog-load': 'failure.drawthingsCatalogLoad',
  'drawthings-download': 'failure.drawthingsDownload',
  'drawthings-browse': 'failure.drawthingsBrowse',
  'drawthings-import': 'failure.drawthingsImport',
  'advanced-elaborators-load': 'failure.advancedElaboratorsLoad',
  'advanced-models-load': 'failure.advancedModelsLoad',
  'advanced-elaborate': 'failure.advancedElaborate',
  'advanced-queue': 'failure.advancedQueue',
  'elaboration-defaults-load': 'failure.elaborationDefaultsLoad',
  'elaboration-save': 'failure.elaborationSave',
  'dependencies-load': 'failure.dependenciesLoad',
  'dependencies-change': 'failure.dependenciesChange',
  'dependencies-cancel': 'failure.dependenciesCancel',
}

/** Arbitrary renderer/IPC exceptions are diagnostic-only; callers render only this authored copy's key. */
export function presentFailure(operation: FailureOperation, error: unknown): MessageKey {
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
