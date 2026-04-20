import { useState, useCallback, useEffect } from 'react'
import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import type { Task } from '../../../shared/types'
import './Layout.css'

const BACKENDS = [
  { id: 'openai' as const, label: 'OpenAI' },
  { id: 'google' as const, label: 'Google' },
  { id: 'flux' as const, label: 'FLUX' },
  { id: 'local' as const, label: 'Local' }
]

export function Layout(): React.JSX.Element {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)

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
      <div className="left-pane">
        <PromptPane selectedTask={selectedTask} previewDataUrl={previewDataUrl} />
      </div>
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
