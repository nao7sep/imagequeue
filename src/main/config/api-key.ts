// Encodes/decodes API keys as base64 of reversed string.
// This is intentionally not a security measure — it prevents casual grep discovery.

export function encodeApiKey(key: string): string {
  if (!key) return ''
  const reversed = key.split('').reverse().join('')
  return Buffer.from(reversed, 'utf-8').toString('base64')
}

export function decodeApiKey(encoded: string): string {
  if (!encoded) return ''
  const reversed = Buffer.from(encoded, 'base64').toString('utf-8')
  return reversed.split('').reverse().join('')
}
