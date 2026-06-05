import { ipcMain } from 'electron'
import { brainstormPrompts, cancelBrainstorm } from './brainstorm'
import { createDefaultConfig } from './config/defaults'
import {
  createElaborator,
  deleteElaborator,
  listElaborators,
  resetElaborators,
  updateElaborator,
} from './elaborators'
import { log } from './logger'
import type { ElaboratorKind } from '../shared/types'

export function registerElaboratorsIpc(): void {
  ipcMain.handle('elaborators:list', () => {
    return listElaborators()
  })

  ipcMain.handle('elaborators:create', (_event, input: { kind: ElaboratorKind; name: string; description?: string; template: string }) => {
    const created = createElaborator(input)
    log('info', 'Elaborator created', { id: created.id, kind: created.kind, name: created.name })
    return created
  })

  ipcMain.handle('elaborators:update', (_event, id: string, patch: { name?: string; description?: string; template?: string }) => {
    const updated = updateElaborator(id, patch)
    if (updated) {
      log('info', 'Elaborator updated', { id, kind: updated.kind, name: updated.name, fields: Object.keys(patch) })
    }
    return updated
  })

  ipcMain.handle('elaborators:delete', (_event, id: string) => {
    const ok = deleteElaborator(id)
    if (ok) log('info', 'Elaborator deleted', { id })
    return ok
  })

  ipcMain.handle('elaborators:reset', (_event, kind?: ElaboratorKind) => {
    const items = resetElaborators(kind)
    log('info', 'Elaborators reset to defaults', { kind: kind ?? 'all', count: items.length })
    return items
  })

  ipcMain.handle(
    'elaborators:brainstorm',
    async (
      _event,
      req: {
        requestId: string
        contentElaboratorId: string
        compositionElaboratorId: string
        styleElaboratorId: string
        seed: string
        count: number
        previousPrompts: string[]
      }
    ) => {
      return brainstormPrompts(req)
    }
  )

  ipcMain.handle('elaborators:brainstormCancel', (_event, requestId: string) => {
    cancelBrainstorm(requestId)
  })

  // Returns the shipped default brainstorm config — used by the Elaboration
  // Settings modal's "Reset to Defaults" button. Reads from the same
  // createDefaultConfig() that seeds new installs, so it stays in sync.
  ipcMain.handle('brainstorm:getDefaults', () => {
    return createDefaultConfig().brainstorm
  })

  // Returns the shipped default slug template — used by Settings' slug field
  // Reset link. Same source of truth as the rest of the defaults.
  ipcMain.handle('prompts:getDefaultSlug', () => {
    return createDefaultConfig().prompts.slug
  })
}
