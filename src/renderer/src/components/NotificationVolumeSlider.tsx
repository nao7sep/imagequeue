import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { Icon } from './Icon'
import './NotificationVolumeSlider.css'

interface Props {
  id?: string
  value: number
  /** Resolves true after saving; false means the owner has presented the failure. */
  onCommit: (value: number) => Promise<boolean>
  ariaLabel?: string
}

const COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** The completion-sound volume: a speaker icon showing the level, muted at zero,
 * and a range input that previews continuously but persists only at a completed
 * pointer/keyboard/blur interaction. Zero is the one muted state. Shared by the
 * two volume surfaces so they cannot drift into different commit semantics. */
export function NotificationVolumeSlider({ id, value, onCommit, ariaLabel }: Props): React.JSX.Element {
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

  const percent = Math.round(draft * 100)
  const level = percent === 0 ? 0 : percent <= 33 ? 1 : percent <= 66 ? 2 : 3
  return (
    <span className={percent === 0 ? 'notification-volume notification-volume-muted' : 'notification-volume'}>
      <Icon name={`volume-${level}`} className="notification-volume-icon" />
      <input
        id={id}
        type="range"
        aria-label={ariaLabel ?? t('volume.label')}
        min={0}
        max={1}
        step={0.05}
        value={draft}
        title={t('volume.title', { percent })}
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
    </span>
  )
}
