import { describe, expect, it } from 'vitest'
import { assertUsableGeminiResponse, assertUsableOpenAIResponse } from '../../src/main/provider-response'

// Every case below is a response the provider DID explain. Letting it through means the caller
// reports its own emptiness — a statement about our parser, not about what happened.
describe('assertUsableGeminiResponse', () => {
  it('surfaces a prompt-level block with its reason', () => {
    expect(() => assertUsableGeminiResponse({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'image'))
      .toThrow(/refused this image \(PROHIBITED_CONTENT\)/)
  })

  it('catches truncation, where the payload is present and looks complete', () => {
    expect(() => assertUsableGeminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'request'))
      .toThrow(/truncated/)
  })

  it('reports any other non-STOP reason', () => {
    expect(() => assertUsableGeminiResponse({ candidates: [{ finishReason: 'RECITATION' }] }, 'request'))
      .toThrow(/stopped early \(RECITATION\)/)
  })

  it('passes a normal stop, and a response carrying no reason at all', () => {
    expect(() => assertUsableGeminiResponse({ candidates: [{ finishReason: 'STOP' }] }, 'x')).not.toThrow()
    expect(() => assertUsableGeminiResponse({}, 'x')).not.toThrow()
  })
})

describe('assertUsableOpenAIResponse', () => {
  it('surfaces a refusal string rather than the null content beside it', () => {
    expect(() => assertUsableOpenAIResponse(
      { choices: [{ finish_reason: 'stop', message: { refusal: 'I cannot help with that.' } }] }, 'request'))
      .toThrow(/declined this request: I cannot help with that\./)
  })

  it('catches a content-filter stop', () => {
    expect(() => assertUsableOpenAIResponse({ choices: [{ finish_reason: 'content_filter' }] }, 'request'))
      .toThrow(/content filter rejected/)
  })

  it('catches a length stop, which otherwise reads as a complete short answer', () => {
    expect(() => assertUsableOpenAIResponse({ choices: [{ finish_reason: 'length' }] }, 'request'))
      .toThrow(/truncated/)
  })

  it('passes a normal stop and an empty response that explains nothing', () => {
    expect(() => assertUsableOpenAIResponse({ choices: [{ finish_reason: 'stop', message: { refusal: null } }] }, 'x')).not.toThrow()
    expect(() => assertUsableOpenAIResponse({}, 'x')).not.toThrow()
  })
})
