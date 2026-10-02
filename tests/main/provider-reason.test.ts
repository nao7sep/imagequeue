import { describe, expect, it } from 'vitest'
import { cleanReason, fluxReasonField, geminiReasonField, grokReasonField, openaiReasonField, reasonFromBody } from '../../src/main/provider-reason'

describe('provider reason fields', () => {
  it('reads each provider\'s documented message field', () => {
    expect(reasonFromBody('{"code":"c","error":"Grok said."}', grokReasonField)).toBe('Grok said.')
    expect(reasonFromBody('{"error":{"message":"Nested."}}', grokReasonField)).toBe('Nested.')
    expect(reasonFromBody('{"detail":"Flux said."}', fluxReasonField)).toBe('Flux said.')
    expect(reasonFromBody('{"detail":[{"msg":"One"},{"msg":"Two"}]}', fluxReasonField)).toBe('One\nTwo')
    expect(reasonFromBody('{"error":{"message":"OpenAI said.","code":"x"}}', openaiReasonField)).toBe('OpenAI said.')
    expect(reasonFromBody('{"error":{"code":400,"message":"Gemini said.","status":"INVALID_ARGUMENT"}}', geminiReasonField)).toBe('Gemini said.')
  })

  it('never falls back to the raw JSON', () => {
    expect(reasonFromBody('{"code":"c","usage":{"cost_in_usd_ticks":1}}', grokReasonField)).toBeNull()
    expect(reasonFromBody('[1,2]', fluxReasonField)).toBeNull()
    expect(reasonFromBody('{"error":"   "}', grokReasonField)).toBeNull()
    expect(reasonFromBody('{"error":{"code":502,"message":"<html>Bad gateway</html>","status":"Bad Gateway"}}', geminiReasonField)).toBeNull()
  })
})

describe('cleanReason', () => {
  it('keeps the reason as written, cleaned as multiline text', () => {
    const said = cleanReason('\n  Key 6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b is invalid.   \n  See ~/secret/file.txt or https://docs.example.com/x?token=abc\n\n')
    expect(said).toBe('  Key 6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b is invalid.\n  See ~/secret/file.txt or https://docs.example.com/x?token=abc')
  })

  it('is null when nothing is left', () => {
    expect(cleanReason(' \n\t ')).toBeNull()
    expect(cleanReason(null)).toBeNull()
  })
})
