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
  // When provided, aborting it cancels the in-flight request. Implementations
  // pass it through to the underlying SDK call so a cancelled brainstorm stops
  // spending tokens immediately rather than only between turns.
  signal?: AbortSignal
}

export interface AskResult {
  text: string
  parsed?: unknown
}

export interface TextAIProvider {
  ask(opts: AskOptions): Promise<AskResult>
}
