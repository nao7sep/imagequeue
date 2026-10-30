import type { InputHTMLAttributes } from 'react'
import { useI18n } from '../i18n/I18nContext'
import type { Translator } from '../../../shared/i18n/translate'
import { parseNumberText, type NumberRule } from '../../../shared/number-field'
import './NumberInput.css'

/** What a field with `rule` accepts, said under it while it holds anything else. */
export function numberRuleMessage(t: Translator['t'], rule: NumberRule): string {
  const { min, max, multipleOf } = rule
  if (multipleOf !== undefined) {
    return max === undefined
      ? t('settings.multipleAtLeast', { step: multipleOf, min })
      : t('settings.multipleRange', { step: multipleOf, min, max })
  }
  if (rule.whole) {
    return max === undefined ? t('settings.wholeNumberAtLeast', { min }) : t('settings.wholeNumberRange', { min, max })
  }
  return max === undefined ? t('settings.numberAtLeast', { min }) : t('settings.numberRange', { min, max })
}

const errorIdFor = (id: string): string => `${id}-error`

/** The message under an invalid number field. */
export function NumberFieldError({ id, rule }: { id: string; rule: NumberRule }): React.JSX.Element {
  const { t } = useI18n()
  return <div id={errorIdFor(id)} className="drawthings-save-error number-field-error" role="alert">{numberRuleMessage(t, rule)}</div>
}

type InputProps = Pick<InputHTMLAttributes<HTMLInputElement>, 'disabled'>

function stepFor(rule: NumberRule): number | 'any' {
  return rule.multipleOf ?? (rule.whole ? 1 : 'any')
}

/** An image column's number row, whose owner holds the typed text itself:
 *  the text stays as typed, and anything `rule` does not accept shows what it
 *  does beneath the row. */
export function NumberSettingRow({ id, label, text, rule, onText, disabled }: {
  id: string
  label: string
  text: string
  rule: NumberRule
  onText: (text: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const invalid = parseNumberText(text, rule) === null
  return <>
    <div className="setting-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={rule.min}
        max={rule.max}
        step={stepFor(rule)}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorIdFor(id) : undefined}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
    </div>
    {invalid && <NumberFieldError id={id} rule={rule} />}
  </>
}

/** The raw text of each number field that does not hold a valid value, by
 *  field id. The owner shows it in the field and refuses Save while any is
 *  present. */
export type InvalidNumberText = Readonly<Record<string, string>>

export function withNumberText(texts: InvalidNumberText, id: string, text: string | null): InvalidNumberText {
  const next = { ...texts }
  if (text === null) delete next[id]
  else next[id] = text
  return next
}

/** A number field over a stored value. Typed text `rule` does not accept is
 *  kept, with what the field accepts beneath it, and never reaches `onValue`;
 *  `onInvalidText` receives the text to keep, or null once the field is valid
 *  again. */
export function NumberInput({ id, value, rule, invalidText, onValue, onInvalidText, ...inputProps }: {
  id: string
  value: number
  rule: NumberRule
  invalidText: string | undefined
  onValue: (value: number) => void
  onInvalidText: (text: string | null) => void
} & InputProps): React.JSX.Element {
  const invalid = invalidText !== undefined
  return <>
    <input
      id={id}
      type="number"
      min={rule.min}
      max={rule.max}
      step={stepFor(rule)}
      {...inputProps}
      aria-invalid={invalid}
      aria-describedby={invalid ? errorIdFor(id) : undefined}
      value={invalid ? invalidText : value}
      onChange={(e) => {
        const next = parseNumberText(e.target.value, rule)
        if (next === null) {
          onInvalidText(e.target.value)
        } else {
          onInvalidText(null)
          onValue(next)
        }
      }}
    />
    {invalid && <NumberFieldError id={id} rule={rule} />}
  </>
}
