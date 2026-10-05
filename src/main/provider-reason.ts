import { multiline } from '../shared/textCleanup'
import type { BackendId } from '../shared/types'

/**
 * A provider's human-readable reason for a failed request, as the task keeps it in
 * `providerMessage`. The reason comes from the documented message field of the provider's
 * error body — never the raw body, so codes, usage and billing fields stay out — and is
 * kept as the provider wrote it, cleaned as multiline text per the text-cleanup-conventions.
 * Each backend picks its own field; a body that is not JSON is taken as the provider's
 * plain-text answer.
 */

/** Reads the reason out of one provider's parsed error body, or null when it has none. */
export type ReasonField = (body: Record<string, unknown>) => string | null

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** xAI answers `{"code": ..., "error": "<reason>"}`; some errors nest `error.message`. */
export const grokReasonField: ReasonField = (body) =>
  text(body.error) ?? text(record(body.error)?.message) ?? text(body.message)

/** BFL answers `{"detail": "<reason>"}`, or FastAPI's `{"detail": [{"msg": ...}]}` for a
 *  rejected parameter. */
export const fluxReasonField: ReasonField = (body) => {
  if (Array.isArray(body.detail)) {
    const messages = body.detail.map((item) => text(record(item)?.msg)).filter((msg): msg is string => !!msg?.trim())
    return messages.length > 0 ? messages.join('\n') : null
  }
  return text(body.detail) ?? text(record(body.detail)?.message) ?? text(body.message)
}

/** OpenAI's error body is `{"error": {"message": ...}}`; the SDK keeps the inner object on
 *  `APIError.error`, so this reads either shape. */
export const openaiReasonField: ReasonField = (body) =>
  text(body.message) ?? text(record(body.error)?.message)

/** Google answers `{"error": {"code": ..., "message": ..., "status": ...}}`, its `status` a
 *  canonical code name such as `NOT_FOUND`. The SDK's `ApiError` carries that body,
 *  serialized, as its message, and wraps a body that is not JSON in the same shape with the
 *  HTTP status text as `status`, so only a canonical code name marks the provider's own
 *  message and raw response text is never taken for one. */
export const geminiReasonField: ReasonField = (body) => {
  const error = record(body.error)
  return typeof error?.status === 'string' && /^[A-Z_]+$/.test(error.status) ? text(error.message) : null
}

/** Each image backend's reason field; Draw Things runs locally and has no provider body. */
const IMAGE_REASON_FIELDS: Record<BackendId, ReasonField | null> = {
  openai: openaiReasonField,
  nanobanana: geminiReasonField,
  grok: grokReasonField,
  flux: fluxReasonField,
  drawthings: null,
}

/** A task's stored `providerMessage` as a session brings it back. An older build kept the
 *  whole error body there; a body that is a JSON object is reduced to its reason, and any
 *  other text is already the reason as the provider wrote it. */
export function storedProviderReason(stored: string, backend: BackendId): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return stored
  }
  const object = record(parsed)
  if (!object) return stored
  const field = IMAGE_REASON_FIELDS[backend]
  return field ? cleanReason(field(object)) : null
}

/** The reason in a provider's raw error response body. */
export function reasonFromBody(body: string, field: ReasonField): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return cleanReason(body)
  }
  const object = record(parsed)
  // A JSON answer without its message field has no reason to show; its other fields
  // (codes, usage, billing) are never a substitute.
  if (object) return cleanReason(field(object))
  return typeof parsed === 'string' ? cleanReason(parsed) : null
}

/** The reason in a body an SDK already parsed. */
export function reasonFromParsed(body: unknown, field: ReasonField): string | null {
  const object = record(body)
  return object ? cleanReason(field(object)) : null
}

/** Cleaned as multiline text; null when nothing is left. */
export function cleanReason(reason: string | null): string | null {
  if (reason === null) return null
  return multiline(reason) || null
}
