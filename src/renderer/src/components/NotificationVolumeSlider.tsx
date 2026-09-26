import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'

interface Props {
  value: number
  onCommit: (value: number) => void
  className?: string
  ariaLabel?: string
}

const COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** A range input that previews continuously but persists only at a completed
 * pointer/keyboard/blur interaction. Shared by the two volume surfaces so they
 * cannot drift into different commit semantics. */
export function NotificationVolumeSlider({ value, onCommit, className, ariaLabel }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState(value)
  const lastCommittedRef = useRef(value)

  useEffect(() => {
    setDraft(value)
    lastCommittedRef.current = value
  }, [value])

  const commit = useCallback((next: number): void => {
    if (!Number.isFinite(next) || next === lastCommittedRef.current) return
    lastCommittedRef.current = next
    onCommit(next)
  }, [onCommit])

  return (
    <input
      type="range"
      className={className}
      aria-label={ariaLabel ?? t('volume.label')}
      min={0}
      max={1}
      step={0.05}
      value={draft}
      title={t('volume.title', { percent: Math.round(draft * 100) })}
      onChange={(event) => setDraft(Number(event.currentTarget.value))}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onKeyUp={(event) => {
        if (COMMIT_KEYS.has(event.key)) commit(Number(event.currentTarget.value))
      }}
      onBlur={(event) => commit(Number(event.currentTarget.value))}
    />
  )
}
