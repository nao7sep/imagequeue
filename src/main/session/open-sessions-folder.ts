import { shell } from 'electron'
import { getSessionsDir } from './session'

/** Opens the folder that holds every session and surfaces an OS shell failure. */
export async function openSessionsFolder(): Promise<void> {
  const error = await shell.openPath(getSessionsDir())
  if (error) throw new Error(`Could not open the ImageQueue sessions folder: ${error}`)
}
