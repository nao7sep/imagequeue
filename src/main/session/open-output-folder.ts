import { shell } from 'electron'
import { getOutputDir } from './session'

/** Opens the process-owned output root and surfaces an OS shell failure. */
export async function openOutputFolder(): Promise<void> {
  const error = await shell.openPath(getOutputDir())
  if (error) throw new Error(`Could not open the ImageQueue output folder: ${error}`)
}
