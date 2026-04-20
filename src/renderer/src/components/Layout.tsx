import { useState, useCallback, useEffect, useRef } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import { Settings } from './Settings'
import type { Task } from '../../../shared/types'
import './Layout.css'

const BACKENDS = [
  { id: 'openai' as const, label: 'OpenAI' },
  { id: 'google' as const, label: 'Google' },
  { id: 'flux' as const, label: 'FLUX' },
  { id: 'local' as const, label: 'Local' }
]

const DEFAULT_LEFT_WIDTH = 360
const MIN_LEFT_WIDTH = 280
const MAX_LEFT_WIDTH = 800

export function Layout(): React.JSX.Element {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH)
  const isDragging = useRef(false)
  const latestWidth = useRef(DEFAULT_LEFT_WIDTH)

  // Load persisted width from config on mount
  useEffect(() => {
    window.electronAPI.getSettings().then((config) => {
      const ui = config.ui as { leftPaneWidth?: number } | undefined
      if (ui?.leftPaneWidth) {
        setLeftWidth(Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, ui.leftPaneWidth)))
      }
    })
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent): void => {
      if (!isDragging.current) return
      const newWidth = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, ev.clientX))
      setLeftWidth(newWidth)
      latestWidth.current = newWidth
    }

    const onMouseUp = (): void => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // Persist to config
      window.electronAPI.saveUi({ leftPaneWidth: latestWidth.current })
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task)
  }, [])

  // Load image data when a completed task is selected
  useEffect(() => {
    if (!selectedTask || selectedTask.status !== 'completed' || !selectedTask.baseName) {
      setPreviewDataUrl(null)
      return
    }

    window.electronAPI.getImage(selectedTask.baseName).then((b64) => {
      if (b64) {
        setPreviewDataUrl(`data:image/png;base64,${b64}`)
      } else {
        setPreviewDataUrl(null)
      }
    })
  }, [selectedTask])

  return (
    <div className="layout">
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <div className="left-pane" style={{ width: leftWidth }}>
        <div className="pane-toolbar">
          <button className="settings-btn" onClick={() => setShowSettings(true)}>⚙ Settings</button>
        </div>
        <PromptPane selectedTask={selectedTask} previewDataUrl={previewDataUrl} />
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="right-pane">
        {BACKENDS.map((b) => (
          <QueueColumn
            key={b.id}
            backendId={b.id}
            label={b.label}
            onSelectTask={handleSelectTask}
          />
        ))}
      </div>
    </div>
  )
}
