import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './CustomSelect.css'

export interface CSOption {
  value: string
  label: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: CSOption[]
  className?: string
}

export function CustomSelect({ value, onChange, options, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value

  const openDropdown = (): void => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const maxH = 240
    const gap = 2
    const below = window.innerHeight - r.bottom - gap
    const above = r.top - gap

    const s: React.CSSProperties = { position: 'fixed', left: r.left, width: r.width, zIndex: 9999 }
    if (below >= Math.min(maxH, 80) || below >= above) {
      s.top = r.bottom + gap
      s.maxHeight = Math.min(maxH, below)
    } else {
      s.bottom = window.innerHeight - r.top + gap
      s.maxHeight = Math.min(maxH, above)
    }
    setStyle(s)
    setOpen(true)
  }

  const handleToggle = (): void => { open ? setOpen(false) : openDropdown() }

  const handleSelect = (val: string): void => { onChange(val); setOpen(false) }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    const scroll = (): void => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])

  return (
    <div className={`cs-wrap${className ? ' ' + className : ''}`}>
      <button ref={triggerRef} type="button" className="cs-trigger" onClick={handleToggle}>
        <span className="cs-label">{selectedLabel}</span>
        <span className="cs-caret">▾</span>
      </button>
      {open && createPortal(
        <ul className="cs-list" style={style}>
          {options.map((o) => (
            <li
              key={o.value}
              className={`cs-item${o.value === value ? ' cs-item-selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(o.value) }}
            >
              {o.label}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
}
