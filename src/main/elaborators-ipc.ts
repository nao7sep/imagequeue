import { handle } from './ipc-boundary'
import { brainstormPrompts, cancelBrainstorm } from './brainstorm'
import { providerMessage, ProviderRefusalError } from './provider-errors'
import { log, serializeError } from './logger'
import type { BrainstormOutcome } from '../shared/text-provider-failure'
import { createDefaultConfig } from './config/defaults'
import {
  createElaborator,
  deleteElaborator,
  listElaborators,
  resetElaborators,
  updateElaborator,
} from './elaborators'
import type { ElaboratorKind } from '../shared/types'
import type { PromptFormat, PromptLength } from '../shared/session-draft'

export function registerElaboratorsIpc(): void {
  handle('elaborators:list', () => listElaborators())

  handle('elaborators:create', async (_event, input: { id?: string; kind: ElaboratorKind; name: string; description?: string; template: string }) => {
    const created = await createElaborator(input)
    log('info', 'Elaborator created', { id: created.id, kind: created.kind, name: created.name })
    return created
  })

  handle('elaborators:update', async (_event, id: string, patch: { name?: string; description?: string; template?: string }) => {
    const updated = await updateElaborator(id, patch)
    if (updated) {
      log('info', 'Elaborator updated', { id, kind: updated.kind, name: updated.name, fields: Object.keys(patch) })
    }
    return updated
  })

  handle('elaborators:delete', async (_event, id: string) => {
    const ok = await deleteElaborator(id)
    if (ok) log('info', 'Elaborator deleted', { id })
    return ok
  })

  handle('elaborators:reset', async (_event, kind?: ElaboratorKind) => {
    const items = await resetElaborators(kind)
    log('info', 'Elaborators reset to defaults', { kind: kind ?? 'all', count: items.length })
    return items
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
      const sender = event.sender
      const cancel = (): void => cancelBrainstorm(req.requestId)
      const navigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean): void => {
        if (isMainFrame && !isInPlace) cancel()
      }
      sender.once('destroyed', cancel)
      sender.once('render-process-gone', cancel)
      sender.on('did-start-navigation', navigation)
      try {
        const { prompts, failure, failureContext } = await brainstormPrompts(req)
        if (failure !== undefined) {
          log('error', 'Brainstorm failed', { ...failureContext, error: serializeError(failure) })
          return { ok: false, prompts, failure: {
            refused: failure instanceof ProviderRefusalError,
            providerMessage: providerMessage(failure),
          } }
        }
        return { ok: true, prompts }
      } catch (error) {
        // Electron passes only an error's message across a rejected invoke, so a provider failure resolves as a typed result.
        const refused = error instanceof ProviderRefusalError
        const said = providerMessage(error)
        if (!refused && !said) throw error
        log('warn', 'Brainstorm provider request failed', { error: serializeError(error) })
        return { ok: false, failure: { refused, providerMessage: said } }
      } finally {
        sender.off('destroyed', cancel)
        sender.off('render-process-gone', cancel)
        sender.off('did-start-navigation', navigation)
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
