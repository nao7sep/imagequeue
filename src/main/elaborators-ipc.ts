import { ipcMain } from 'electron'
import { brainstormPrompts } from './brainstorm'
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

  ipcMain.handle('elaborators:brainstorm', async (_event, elaboratorId: string, seed: string, count: number) => {
    return brainstormPrompts(elaboratorId, seed, count)
  })
}
