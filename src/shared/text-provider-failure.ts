import type { ElaboratedPromptRecord } from './types'

/** A text provider's failure as the renderer presents it: whether the provider
 *  refused the input, which a retry cannot change, and the provider's own
 *  cleaned reason when it gave one. */
export interface TextProviderFailure {
  refused: boolean
  providerMessage: string | null
}

export type BrainstormOutcome =
  | { ok: true; prompts: ElaboratedPromptRecord[] }
  | { ok: false; failure: TextProviderFailure }
