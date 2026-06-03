import { log } from '../logger'
import { ImageExt } from './file-output'

const KNOWN_EXTS: ReadonlySet<ImageExt> = new Set(['png', 'jpg', 'webp'])

// Maps a MIME type string (case-insensitive, parameters tolerated) to one of
// our supported image extensions. Returns null when the MIME type is missing
// or not one of the supported types.
function mimeToExt(mime: string | undefined | null): ImageExt | null {
  if (!mime) return null
  const normalized = mime.split(';')[0].trim().toLowerCase()
  switch (normalized) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    default:
      return null
  }
}

// Sniffs magic bytes from the start of a buffer to identify the image type.
// Returns null when the buffer is too short or the signature is unrecognized.
function sniffMagicBytes(buf: Buffer): ImageExt | null {
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'png'
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg'
  }
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return 'webp'
  }
  return null
}

// Determines the correct file extension for an image buffer. Tries, in order:
// 1) the MIME type hint provided by the backend (when one of png/jpeg/webp),
// 2) magic-byte sniffing of the buffer,
// 3) the per-backend fallback extension.
//
// When the MIME hint and the sniffed bytes disagree, the sniffed value wins
// and a warning is logged. When neither yields a known type, the fallback is
// used and a warning is logged.
export function detectImageExt(
  buffer: Buffer,
  mimeHint: string | undefined | null,
  fallback: ImageExt,
  context: { backend?: string; model?: string } = {}
): ImageExt {
  const fromMime = mimeToExt(mimeHint)
  const fromMagic = sniffMagicBytes(buffer)

  if (fromMagic && fromMime && fromMagic !== fromMime) {
    log('warn', 'Image MIME hint and magic bytes disagree; using magic bytes', {
      ...context,
      mimeHint,
      mimeExt: fromMime,
      magicExt: fromMagic
    })
    return fromMagic
  }

  if (fromMagic) return fromMagic
  if (fromMime) return fromMime

  log('warn', 'Could not determine image type; using fallback', {
    ...context,
    mimeHint: mimeHint ?? null,
    bufferHead: buffer.slice(0, 16).toString('hex'),
    fallback
  })
  return fallback
}

export { KNOWN_EXTS }
