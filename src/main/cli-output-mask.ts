// Keep only a possible credential/pattern prefix. Signed URL values are
// discarded as they arrive, so even an unbounded signature cannot accumulate.
export function createCliOutputMask(credentials: () => readonly string[]) {
  let prefix = ''
  let signature = false
  let signatureMasked = false
  const signatures = ['?sig=', '&sig=']
  const redact = '[REDACTED]'
  const boundary = (char: string): boolean => /[&#\s"]/.test(char)
  return {
    append(text: string, final = false): string {
      const patterns = [...credentials().filter(Boolean), ...signatures].sort((a, b) => b.length - a.length)
      const output: string[] = []
      const drain = (atEnd: boolean): void => {
        while (prefix) {
          if (signature) {
            const char = prefix[0]
            if (!boundary(char)) {
              if (!signatureMasked) output.push(redact)
              signatureMasked = true
              prefix = prefix.slice(1)
              continue
            }
            signature = false
            signatureMasked = false
          }
          // A complete shorter key can still be the prefix of a longer one.
          if (!atEnd && patterns.some((pattern) => pattern.length > prefix.length && pattern.startsWith(prefix))) return
          const matched = patterns.find((pattern) => prefix.startsWith(pattern))
          if (matched) {
            if (signatures.includes(matched)) { output.push(matched); signature = true }
            else output.push(redact)
            prefix = prefix.slice(matched.length)
          } else {
            // Preserve a surrogate pair split by a string-producing source.
            if (!atEnd && prefix.length === 1 && /[\uD800-\uDBFF]/.test(prefix)) return
            output.push(prefix[0])
            prefix = prefix.slice(1)
          }
        }
      }
      for (let index = 0; index < text.length; index++) { prefix += text[index]; drain(false) }
      if (final) drain(true)
      return output.join('')
    }
  }
}
