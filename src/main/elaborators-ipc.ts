import { ipcMain } from 'electron'
import { brainstormPrompts } from './brainstorm'
import { createDefaultConfig } from './config/defaults'
import {
  createElaborator,
  deleteElaborator,
  listElaborators,
  resetElaborators,
  updateElaborator,
} from './elaborators'

export function registerElaboratorsIpc(): void {
  ipcMain.handle('elaborators:list', () => {
    return listElaborators()
  })

  ipcMain.handle('elaborators:create', (_event, input: { name: string; description?: string; template: string }) => {
    return createElaborator(input)
  })

  ipcMain.handle('elaborators:update', (_event, id: string, patch: { name?: string; description?: string; template?: string }) => {
    return updateElaborator(id, patch)
  })

  ipcMain.handle('elaborators:delete', (_event, id: string) => {
    return deleteElaborator(id)
  })

  ipcMain.handle('elaborators:reset', () => {
    return resetElaborators()
  })

  ipcMain.handle(
    'elaborators:brainstorm',
    async (_event, req: { requestId: string; elaboratorId: string; seed: string; count: number; previousPrompts: string[] }) => {
      return brainstormPrompts(req)
    }
  )

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
