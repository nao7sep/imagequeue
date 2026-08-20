import { dialog } from 'electron'
import { handle } from './ipc-boundary'
import { brainstormPrompts, cancelBrainstorm } from './brainstorm'
import { createDefaultConfig } from './config/defaults'
import {
  createElaborator,
  deleteElaborator,
  drainElaboratorRecoveryNotices,
  listElaborators,
  resetElaborators,
  updateElaborator,
} from './elaborators'
import { log } from './logger'
import type { ElaboratorKind } from '../shared/types'
import type { PromptFormat, PromptLength } from '../shared/session-draft'

export function registerElaboratorsIpc(): void {
  const reportRecovery = (): void => {
    for (const notice of drainElaboratorRecoveryNotices()) {
      if (notice.kind === 'recovered') {
        dialog.showErrorBox(
          'Elaborator settings were reset',
          'Your elaborator settings file was unreadable and has been set aside here:\n\n' +
            notice.path +
            '\n\nImageQueue restored the shipped defaults. Your edited templates remain in the file above.'
        )
      } else if (notice.kind === 'quarantine-failed') {
        dialog.showErrorBox(
          'Elaborator settings could not be read',
          'ImageQueue left the unreadable file in place because it could not set it aside:\n\n' +
            notice.path +
            '\n\n' + notice.error +
            '\n\nNo replacement file was written.'
        )
      } else {
        dialog.showErrorBox(
          'Elaborator defaults could not be restored',
          'ImageQueue preserved the unreadable elaborator settings here:\n\n' +
            notice.path +
            '\n\nIt could not write the replacement defaults:\n\n' + notice.error +
            '\n\nCorrect the reported problem, then try again.'
        )
      }
    }
  }

  const withRecoveryReport = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    try {
      const result = operation()
      // Async functions run synchronously until their first await, which covers
      // the store read at the start of brainstormPrompts.
      reportRecovery()
      return await result
    } finally {
      reportRecovery()
    }
  }

  handle('elaborators:list', () => withRecoveryReport(listElaborators))

  handle('elaborators:create', (_event, input: { kind: ElaboratorKind; name: string; description?: string; template: string }) => {
    return withRecoveryReport(() => {
      const created = createElaborator(input)
      log('info', 'Elaborator created', { id: created.id, kind: created.kind, name: created.name })
      return created
    })
  })

  handle('elaborators:update', (_event, id: string, patch: { name?: string; description?: string; template?: string }) => {
    return withRecoveryReport(() => {
      const updated = updateElaborator(id, patch)
      if (updated) {
        log('info', 'Elaborator updated', { id, kind: updated.kind, name: updated.name, fields: Object.keys(patch) })
      }
      return updated
    })
  })

  handle('elaborators:delete', (_event, id: string) => {
    return withRecoveryReport(() => {
      const ok = deleteElaborator(id)
      if (ok) log('info', 'Elaborator deleted', { id })
      return ok
    })
  })

  handle('elaborators:reset', (_event, kind?: ElaboratorKind) => {
    const items = resetElaborators(kind)
    log('info', 'Elaborators reset to defaults', { kind: kind ?? 'all', count: items.length })
    return items
  })

  handle(
    'elaborators:brainstorm',
    async (
      _event,
      req: {
        requestId: string
            compositionElaboratorId: string
        styleElaboratorId: string
        seed: string
        count: number
        format: PromptFormat
        length: PromptLength
      }
    ) => {
      return withRecoveryReport(() => brainstormPrompts(req))
    }
  )

  handle('elaborators:brainstormCancel', (_event, requestId: string) => {
    cancelBrainstorm(requestId)
  })

  // Returns the shipped default brainstorm config — used by the Elaboration
  // Settings modal's "Reset to Defaults" button. Reads from the same
  // createDefaultConfig() that seeds new installs, so it stays in sync.
  handle('brainstorm:getDefaults', () => {
    return createDefaultConfig().brainstorm
  })

  // Returns the shipped default slug template — used by Settings' slug field
  // Reset link. Same source of truth as the rest of the defaults.
  handle('prompts:getDefaultSlug', () => {
    return createDefaultConfig().prompts.slug
  })
}
