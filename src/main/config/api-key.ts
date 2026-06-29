// Encodes/decodes API keys as `obf:` + base64 of the reversed UTF-8 bytes, per
// the api-key-storage-conventions. This is intentionally not a security measure —
// the 0600 file mode is. Operating on bytes (not characters) keeps it identical
// to the convention's `obf:` algorithm across languages; an untagged value is
// treated as plaintext (a hand-pasted key).

const MARKER = 'obf:'

export function encodeApiKey(key: string): string {
  if (!key) return ''
  return MARKER + Buffer.from(Buffer.from(key, 'utf-8')).reverse().toString('base64')
}

export function decodeApiKey(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(MARKER)) return stored
  return Buffer.from(Buffer.from(stored.slice(MARKER.length), 'base64')).reverse().toString('utf-8')
}
