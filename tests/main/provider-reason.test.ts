import { describe, expect, it } from 'vitest'
import { cleanReason, fluxReasonField, grokReasonField, openaiReasonField, reasonFromBody } from '../../src/main/provider-reason'

describe('provider reason fields', () => {
  it('reads each provider\'s documented message field', () => {
    expect(reasonFromBody('{"code":"c","error":"Grok said."}', grokReasonField)).toBe('Grok said.')
    expect(reasonFromBody('{"error":{"message":"Nested."}}', grokReasonField)).toBe('Nested.')
    expect(reasonFromBody('{"detail":"Flux said."}', fluxReasonField)).toBe('Flux said.')
    expect(reasonFromBody('{"detail":[{"msg":"One"},{"msg":"Two"}]}', fluxReasonField)).toBe('One\nTwo')
    expect(reasonFromBody('{"error":{"message":"OpenAI said.","code":"x"}}', openaiReasonField)).toBe('OpenAI said.')
  })

  it('never falls back to the raw JSON', () => {
    expect(reasonFromBody('{"code":"c","usage":{"cost_in_usd_ticks":1}}', grokReasonField)).toBeNull()
    expect(reasonFromBody('[1,2]', fluxReasonField)).toBeNull()
    expect(reasonFromBody('{"error":"   "}', grokReasonField)).toBeNull()
  })
})

describe('cleanReason', () => {
  it('redacts a UUID-shaped key but keeps a URL\'s path and plain prose', () => {
    const said = cleanReason('Key 6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b is invalid. See https://docs.example.com/errors/auth for help.')
    expect(said).toBe('Key [redacted] is invalid. See https://docs.example.com/errors/auth for help.')
  })

  it('redacts home-relative and absolute paths', () => {
    expect(cleanReason('Could not read ~/secret/file.txt or /var/lib/app/data')).toBe('Could not read [redacted] or [redacted]')
  })
})
