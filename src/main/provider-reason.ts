import { multiline } from '../shared/textCleanup'

/**
 * A provider's human-readable reason for a failed request, as the task keeps it in
 * `providerMessage`. The reason comes from the documented message field of the provider's
 * error body — never the raw body, so codes, usage and billing fields stay out — and is
 * cleaned and redacted before it is stored. Each backend picks its own field; a body that
 * is not JSON is taken as the provider's plain-text answer.
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

const REDACTED = '[redacted]'

// Applied in order. A URL keeps its origin and path but loses its query and fragment;
// a credential or a long opaque token is replaced whole; a filesystem path is replaced
// whole. The path rule does not start after ':' or '/', so a URL's '//' is not a path.
const REDACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/(\bhttps?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, `$1?${REDACTED}`],
  [/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`],
  [/\b((?:api[_-]?key|x-key|key|token|secret|password|authorization)["']?\s*[:=]\s*)["']?[^\s"',;]+/gi, `$1${REDACTED}`],
  [/\b(?:sk|xai|pk|rk)-[A-Za-z0-9_*.-]{4,}/g, REDACTED],
  [/(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g, REDACTED],
  [/\b[A-Za-z]:\\[^\s"'<>]*/g, REDACTED],
  [/(^|[\s"'(=[])(?:~\/|\/(?!\/))[^\s"'()<>]*\/[^\s"'()<>]*/gm, `$1${REDACTED}`],
]

/** Trimmed, with credentials, tokens, paths and URL queries redacted; null when nothing
 *  is left. */
export function cleanReason(reason: string | null): string | null {
  if (reason === null) return null
  // A reason is prose, not an indented body, so its first line's indentation goes too.
  let cleaned = multiline(reason).trim()
  for (const [pattern, replacement] of REDACTIONS) cleaned = cleaned.replace(pattern, replacement)
  return cleaned || null
}
