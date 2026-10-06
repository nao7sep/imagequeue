import type { WebContents } from 'electron'
import { handle } from './ipc-boundary'
import { brainstormPrompts, cancelBrainstorm } from './brainstorm'
import { providerMessage, ProviderRefusalError } from './provider-errors'
import { log, serializeError } from './logger'
import type { BrainstormOutcome } from '../shared/text-provider-failure'
import { createDefaultConfig } from './config/defaults'
import {
  createElaborator,
  deleteElaborator,
  drainElaboratorRecoveryNotices,
  listElaborators,
  resetElaborators,
  updateElaborator,
} from './elaborators'
import type { ElaboratorKind } from '../shared/types'
import type { PromptFormat, PromptLength } from '../shared/session-draft'
import { conceptLibraryResetPresentation, elaboratorRecoveryPresentation } from './failure-presentation'
import { drainSetAsideConceptStorePaths } from './concepts/concept-store'

export function registerElaboratorsIpc(): void {
  const reportRecovery = (target: WebContents): void => {
    for (const notice of drainElaboratorRecoveryNotices()) {
      const presentation = elaboratorRecoveryPresentation(notice)
      if (presentation) target.send('app:notice', presentation)
    }
    for (const movedTo of drainSetAsideConceptStorePaths()) {
      target.send('app:notice', conceptLibraryResetPresentation(movedTo))
    }
  }

  const withRecoveryReport = async <T>(target: WebContents, operation: () => T | Promise<T>): Promise<T> => {
    try {
      const result = operation()
      // Async functions run synchronously until their first await, which covers
      // the store read at the start of brainstormPrompts.
      reportRecovery(target)
      return await result
    } finally {
      reportRecovery(target)
    }
  }

  handle('elaborators:list', (event) => withRecoveryReport(event.sender, listElaborators))

  handle('elaborators:create', (event, input: { kind: ElaboratorKind; name: string; description?: string; template: string }) => {
    return withRecoveryReport(event.sender, () => {
      const created = createElaborator(input)
      log('info', 'Elaborator created', { id: created.id, kind: created.kind, name: created.name })
      return created
    })
  })

  handle('elaborators:update', (event, id: string, patch: { name?: string; description?: string; template?: string }) => {
    return withRecoveryReport(event.sender, () => {
      const updated = updateElaborator(id, patch)
      if (updated) {
        log('info', 'Elaborator updated', { id, kind: updated.kind, name: updated.name, fields: Object.keys(patch) })
      }
      return updated
    })
  })

  handle('elaborators:delete', (event, id: string) => {
    return withRecoveryReport(event.sender, () => {
      const ok = deleteElaborator(id)
      if (ok) log('info', 'Elaborator deleted', { id })
      return ok
    })
  })

  handle('elaborators:reset', (event, kind?: ElaboratorKind) => {
    return withRecoveryReport(event.sender, () => {
      const items = resetElaborators(kind)
      log('info', 'Elaborators reset to defaults', { kind: kind ?? 'all', count: items.length })
      return items
    })
  })

  handle(
    'elaborators:brainstorm',
    async (
      event,
      req: {
        requestId: string
            compositionElaboratorId: string
        styleElaboratorId: string
        seed: string
        count: number
        format: PromptFormat
        length: PromptLength
      }
    ): Promise<BrainstormOutcome> => {
      try {
        const { prompts } = await withRecoveryReport(event.sender, () => brainstormPrompts(req))
        return { ok: true, prompts }
      } catch (error) {
        // Electron passes only an error's message across a rejected invoke, so a provider failure resolves as a typed result.
        const refused = error instanceof ProviderRefusalError
        const said = providerMessage(error)
        if (!refused && !said) throw error
        log('warn', 'Brainstorm provider request failed', { error: serializeError(error) })
        return { ok: false, failure: { refused, providerMessage: said } }
      }
    }
  )

  handle('elaborators:brainstormCancel', (_event, requestId: string) => {
    cancelBrainstorm(requestId)
  })

  // Returns the shipped default brainstorm config — used by the Elaboration
  // Settings modal's "Reset to Defaults" button. Reads from the same
  // createDefaultConfig() used for absent sets, so it stays in sync.
  handle('brainstorm:getDefaults', () => {
    return createDefaultConfig().brainstorm
  })

  // Returns the shipped default slug template — used by Settings' slug field
  // Reset link. Same source of truth as the rest of the defaults.
  handle('prompts:getDefaultSlug', () => {
    return createDefaultConfig().prompts.slug
  })
}
