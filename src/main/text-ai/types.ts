// Provider-agnostic text-AI interface. Implementers slot in via
// getMainProvider / getLightProvider.

import type { AiCall } from '../records'

export interface ConversationMessage {
  role: 'user' | 'model'
  text: string
}

export interface AskOptions {
  messages: ConversationMessage[]
  // When provided, the response must match this JSON schema. Provider
  // implementations are responsible for asking the model in JSON mode and
  // populating `parsed` on the result.
  schema?: object
  timeoutMs: number
  // Passed through to the SDK to cancel the local request and prevent later
  // turns. A provider may continue processing or charge for already accepted work.
  signal?: AbortSignal
  // What the call is for and what it belongs to, for its record.
  record: Pick<AiCall, 'purpose' | 'taskId' | 'requestId'>
}

export interface AskResult {
  text: string
  parsed?: unknown
}

export interface TextAIProvider {
  ask(opts: AskOptions): Promise<AskResult>
}
