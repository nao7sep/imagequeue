// The provider's integer seed must describe the whole field. Number/parseInt
// alone accept notation or prefixes that turn a pasted seed into another one.
export const IMAGE_SEED_LIMITS = {
  flux: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
  drawthings: { min: 0, max: 0xffffffff },
} as const

export function resolveImageSeed(text: string, backend: keyof typeof IMAGE_SEED_LIMITS):
  { valid: true; seed: number | null } | { valid: false } {
  const value = text.trim()
  if (!value) return { valid: true, seed: backend === 'drawthings' ? 0 : null }
  if (!/^[+-]?\d+$/.test(value)) return { valid: false }
  const seed = Number(value)
  const { min, max } = IMAGE_SEED_LIMITS[backend]
  return Number.isSafeInteger(seed) && seed >= min && seed <= max
    ? { valid: true, seed } : { valid: false }
}
