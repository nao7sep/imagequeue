import { ipcMain, shell } from 'electron'
import { deleteSession, listSessions, resolveSessionDir, resumeSession } from './state'

export function registerSessionIpc(): void {
  ipcMain.handle('session:list', () => {
    return listSessions()
  })

  ipcMain.handle('session:resume', (_event, sessionId: string) => {
    resumeSession(sessionId)
  })

  ipcMain.handle('session:delete', (_event, sessionId: string) => {
    return deleteSession(sessionId)
  })

  ipcMain.handle('session:openFolder', async (_event, sessionId: string) => {
    await shell.openPath(resolveSessionDir(sessionId))
  })
}
