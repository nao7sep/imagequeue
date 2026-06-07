import { ipcMain, shell } from 'electron'
import type { SessionDraft } from '../../shared/session-draft'
import {
  appendActiveSessionElaboratedPrompts,
  clearActiveSessionElaboratedPrompts,
  createSession,
  deleteActiveSessionElaboratedPromptAt,
  deleteSession,
  getActiveSessionDraft,
  getActiveSessionElaboratedPrompts,
  listSessions,
  resolveSessionDir,
  resumeSession,
  setActiveSessionDraft,
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

  ipcMain.handle('session:getDraft', () => {
    return getActiveSessionDraft()
  })

  ipcMain.handle('session:saveDraft', (_event, draft: SessionDraft) => {
    setActiveSessionDraft(draft)
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
