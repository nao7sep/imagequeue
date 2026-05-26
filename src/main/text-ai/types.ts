// Provider-agnostic text-AI interface. Implementers slot in via
// getMainProvider / getLightProvider.

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
}

export interface AskResult {
  text: string
  parsed?: unknown
}

export interface TextAIProvider {
  ask(opts: AskOptions): Promise<AskResult>
}
