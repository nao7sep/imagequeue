import { shell } from 'electron'
import { handle } from '../ipc-boundary'
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
  handle('session:create', async () => {
    await createSession()
  })

  handle('session:list', () => {
    return listSessions()
  })

  handle('session:resume', async (_event, sessionId: string) => {
    await resumeSession(sessionId)
  })

  handle('session:delete', (_event, sessionId: string) => {
    return deleteSession(sessionId)
  })

  handle('session:openFolder', async (_event, sessionId: string) => {
    await shell.openPath(resolveSessionDir(sessionId))
  })

  handle('session:getDraft', () => {
    return getActiveSessionDraft()
  })

  handle('session:saveDraft', (_event, draft: SessionDraft) => {
    setActiveSessionDraft(draft)
  })

  handle('session:getElaboratedPrompts', () => {
    return getActiveSessionElaboratedPrompts()
  })

  handle('session:appendElaboratedPrompts', (_event, prompts: string[]) => {
    return appendActiveSessionElaboratedPrompts(prompts)
  })

  handle('session:deleteElaboratedPromptAt', (_event, index: number) => {
    return deleteActiveSessionElaboratedPromptAt(index)
  })

  handle('session:clearElaboratedPrompts', () => {
    return clearActiveSessionElaboratedPrompts()
  })
}
