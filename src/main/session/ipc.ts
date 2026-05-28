import { ipcMain, shell } from 'electron'
import {
  appendActiveSessionElaboratedPrompts,
  clearActiveSessionElaboratedPrompts,
  createSession,
  deleteActiveSessionElaboratedPromptAt,
  deleteSession,
  getActiveSessionElaboratedPrompts,
  listSessions,
  resolveSessionDir,
  resumeSession,
} from './state'

export function registerSessionIpc(): void {
  ipcMain.handle('session:create', async () => {
    await createSession()
  })

  ipcMain.handle('session:list', () => {
    return listSessions()
  })

  ipcMain.handle('session:resume', async (_event, sessionId: string) => {
    await resumeSession(sessionId)
  })

  ipcMain.handle('session:delete', (_event, sessionId: string) => {
    return deleteSession(sessionId)
  })

  ipcMain.handle('session:openFolder', async (_event, sessionId: string) => {
    await shell.openPath(resolveSessionDir(sessionId))
  })

  ipcMain.handle('session:getElaboratedPrompts', () => {
    return getActiveSessionElaboratedPrompts()
  })

  ipcMain.handle('session:appendElaboratedPrompts', (_event, prompts: string[]) => {
    return appendActiveSessionElaboratedPrompts(prompts)
  })

  ipcMain.handle('session:deleteElaboratedPromptAt', (_event, index: number) => {
    return deleteActiveSessionElaboratedPromptAt(index)
  })

  ipcMain.handle('session:clearElaboratedPrompts', () => {
    return clearActiveSessionElaboratedPrompts()
  })
}
