import type { InputHTMLAttributes } from 'react'
import { useI18n } from '../i18n/I18nContext'
import './WholeNumberInput.css'

export interface WholeNumberLimits { min: number; max?: number }

// The whole field must be a whole number in range: parseInt alone would read
// "2.5" as 2 and an empty field as nothing, and a fallback would then replace
// what the user typed with another number without saying so.
function parseWholeNumber(text: string, { min, max }: WholeNumberLimits): number | null {
  const value = text.trim()
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= min && (max === undefined || number <= max) ? number : null
}

/** The raw text of each whole-number field that does not hold a valid value,
 *  by field id. The owner shows it in the field and refuses Save while any is
 *  present. */
export type InvalidNumberText = Readonly<Record<string, string>>

export function withNumberText(texts: InvalidNumberText, id: string, text: string | null): InvalidNumberText {
  const next = { ...texts }
  if (text === null) delete next[id]
  else next[id] = text
  return next
}

/** A number input whose typed value is kept when it is not a whole number in
 *  `limits`, with a field error beneath it, like the image seed fields. A valid
 *  value reaches `onValue`; `onInvalidText` receives the text to keep, or null
 *  once the field is valid again. */
export function WholeNumberInput({ id, value, limits, invalidText, onValue, onInvalidText, ...inputProps }: {
  id: string
  value: number
  limits: WholeNumberLimits
  invalidText: string | undefined
  onValue: (value: number) => void
  onInvalidText: (text: string | null) => void
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'disabled' | 'max'>): React.JSX.Element {
  const { t } = useI18n()
  const invalid = invalidText !== undefined
  const errorId = `${id}-error`
  return <>
    <input
      id={id}
      type="number"
      min={limits.min}
      max={limits.max}
      step={1}
      {...inputProps}
      aria-invalid={invalid}
      aria-describedby={invalid ? errorId : undefined}
      value={invalid ? invalidText : value}
      onChange={(e) => {
        const next = parseWholeNumber(e.target.value, limits)
        if (next === null) {
          onInvalidText(e.target.value)
        } else {
          onInvalidText(null)
          onValue(next)
        }
      }}
    />
    {invalid && <div id={errorId} className="drawthings-save-error whole-number-error" role="alert">
      {limits.max === undefined
        ? t('settings.wholeNumberAtLeast', { min: limits.min })
        : t('settings.wholeNumberRange', { min: limits.min, max: limits.max })}
    </div>}
  </>
}
