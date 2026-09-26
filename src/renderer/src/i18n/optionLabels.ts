import type { SizePreset, SizeShape } from '../../../shared/models'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import type { Translator } from '../../../shared/i18n/translate'

// Option values the providers define ('low', 'auto', 'opaque') are stored and
// sent as they are; the interface shows each one in the reader's language.
const OPTION_LABELS: Record<string, MessageKey> = {
  low: 'option.low',
  medium: 'option.medium',
  high: 'option.high',
  auto: 'option.auto',
  opaque: 'option.opaque',
  transparent: 'option.transparent',
}

/** A provider option value's label; a value the map does not know shows as itself. */
export function optionLabel(t: Translator['t'], value: string): string {
  const key = OPTION_LABELS[value]
  return key ? t(key) : value
}

const NAMED_SHAPES: Record<Exclude<SizeShape, `${number}:${number}`>, MessageKey> = {
  square: 'size.square',
  squareLarge: 'size.squareLarge',
  a4Wide: 'size.a4Wide',
  letterWide: 'size.letterWide',
  qhdWide: 'size.qhdWide',
  uhdWide: 'size.uhdWide',
  a4Tall: 'size.a4Tall',
  letterTall: 'size.letterTall',
  qhdTall: 'size.qhdTall',
  uhdTall: 'size.uhdTall',
}

/** "1536×1024 (3:2)", with a named shape ("Square", "A4 Wide") in the reader's language. */
export function sizePresetLabel(t: Translator['t'], preset: SizePreset): string {
  const shape = preset.shape in NAMED_SHAPES
    ? t(NAMED_SHAPES[preset.shape as keyof typeof NAMED_SHAPES])
    : preset.shape
  return t('size.preset', { width: String(preset.width), height: String(preset.height), shape })
}
