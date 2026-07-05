// Encodes/decodes API keys as `obf:` + base64 of the reversed UTF-8 bytes, per
// the api-key-storage-conventions. This is intentionally not a security measure —
// the 0600 file mode is. Operating on bytes (not characters) keeps it identical
// to the convention's `obf:` algorithm across languages; an untagged value is
// treated as plaintext (a hand-pasted key).

const MARKER = 'obf:'

// RFC 4648 base64 alphabet with optional padding, and nothing else. Node's
// Buffer.from(str, 'base64') is lenient — it silently ignores characters
// outside the alphabet and does not require correct padding — so a malformed
// `obf:` payload (a hand-edit gone wrong, truncated copy/paste) would
// otherwise decode to non-empty garbage that gets sent to a provider as an API
// key instead of being caught. This regex plus the length%4 check below is the
// canonical shape check the api-key-storage-conventions calls for; it is
// deliberately checked before any decoding is attempted.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

function isCanonicalBase64(payload: string): boolean {
  return payload.length > 0 && payload.length % 4 === 0 && BASE64_RE.test(payload)
}

export function encodeApiKey(key: string): string {
  if (!key) return ''
  return MARKER + Buffer.from(Buffer.from(key, 'utf-8')).reverse().toString('base64')
}

// True when `stored` is safe to decode: untagged (plaintext, used as-is), the
// empty string (no value), or `obf:`-tagged with a canonically valid base64
// payload. False means the marked value is malformed — the caller (which
// knows the key id) treats it as absent and warns once, naming the id, per the
// api-key-storage-conventions' "malformed → absent" corruption rule.
export function isValidStoredApiKey(stored: string): boolean {
  if (!stored) return true
  if (!stored.startsWith(MARKER)) return true
  return isCanonicalBase64(stored.slice(MARKER.length))
}

export function decodeApiKey(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(MARKER)) return stored
  const payload = stored.slice(MARKER.length)
  if (!isCanonicalBase64(payload)) return ''
  return Buffer.from(Buffer.from(payload, 'base64')).reverse().toString('utf-8')
}
