import { useEffect } from 'react'
import type { DraftSurface } from '../../../shared/quit'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'

function report(surface: DraftSurface, dirty: boolean): void {
  void window.electronAPI.reportUnsavedDraft(surface, dirty).catch((error) => {
    recordOperationalDiagnostic('Reporting unsaved edits for quit failed', error, { surface })
  })
}

/** Tells main whether this dialog holds unsaved edits, so closing the window
 *  or quitting asks once before discarding them (unsaved-edits-conventions).
 *  A dialog that closes takes its report with it. */
export function useUnsavedDraftReport(surface: DraftSurface, dirty: boolean): void {
  useEffect(() => { report(surface, dirty) }, [surface, dirty])
  useEffect(() => () => report(surface, false), [surface])
}
