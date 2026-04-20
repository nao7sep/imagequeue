import { PromptPane } from './PromptPane'
import { QueueColumn } from './QueueColumn'
import './Layout.css'

const BACKENDS = [
  { id: 'openai' as const, label: 'OpenAI' },
  { id: 'google' as const, label: 'Google' },
  { id: 'flux' as const, label: 'FLUX' },
  { id: 'local' as const, label: 'Local' }
]

export function Layout(): React.JSX.Element {
  return (
    <div className="layout">
      <div className="left-pane">
        <PromptPane />
      </div>
      <div className="right-pane">
        {BACKENDS.map((b) => (
          <QueueColumn key={b.id} backendId={b.id} label={b.label} />
        ))}
      </div>
    </div>
  )
}
