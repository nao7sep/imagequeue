import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'

interface Props {
  id?: string
  value: number
  /** Resolves true after saving; false means the owner has presented the failure. */
  onCommit: (value: number) => Promise<boolean>
  className?: string
  ariaLabel?: string
}

const COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** A range input that previews continuously but persists only at a completed
 * pointer/keyboard/blur interaction. Shared by the two volume surfaces so they
 * cannot drift into different commit semantics. */
export function NotificationVolumeSlider({ id, value, onCommit, className, ariaLabel }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState(value)
  const revision = useRef(0)
  const submittedRevision = useRef(-1)
  const dirty = useRef(false)

  useEffect(() => {
    // A previous save or the other surface cannot erase a newer gesture.
    if (!dirty.current) setDraft(value)
  }, [value])

  const commit = useCallback((next: number): void => {
    if (!dirty.current || !Number.isFinite(next) || submittedRevision.current === revision.current) return
    const attempt = revision.current
    submittedRevision.current = attempt
    void onCommit(next).then((saved) => {
      if (revision.current !== attempt) return
      if (saved) dirty.current = false
      else submittedRevision.current = -1 // Keep the draft available for retry.
    })
  }, [onCommit])

  return (
    <input
      id={id}
      type="range"
      className={className}
      aria-label={ariaLabel ?? t('volume.label')}
      min={0}
      max={1}
      step={0.05}
      value={draft}
      title={t('volume.title', { percent: Math.round(draft * 100) })}
      onChange={(event) => {
        revision.current++
        dirty.current = true
        setDraft(Number(event.currentTarget.value))
      }}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onKeyUp={(event) => {
        if (COMMIT_KEYS.has(event.key)) commit(Number(event.currentTarget.value))
      }}
      onBlur={(event) => commit(Number(event.currentTarget.value))}
    />
  )
}
