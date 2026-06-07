import { Layout } from './components/Layout'
import { CliJobsPanel } from './components/CliJobsPanel'
import { ResumeInterruptedPrompt } from './components/ResumeInterruptedPrompt'
import { ConfirmProvider } from './context/ConfirmContext'
import { CliJobsProvider } from './context/CliJobsContext'
import { QueueProvider } from './context/QueueContext'
import { SelectionProvider } from './context/SelectionContext'
import { SettingsProvider } from './context/SettingsContext'
import { SessionDraftProvider } from './context/SessionDraftContext'
import { EnqueueConfigProvider } from './context/EnqueueConfigContext'
import './styles.css'

export function App(): React.JSX.Element {
  return (
    <CliJobsProvider>
      <ConfirmProvider>
        <SettingsProvider>
          <QueueProvider>
            <SelectionProvider>
              <EnqueueConfigProvider>
                <SessionDraftProvider>
                  <Layout />
                  <CliJobsPanel />
                  <ResumeInterruptedPrompt />
                </SessionDraftProvider>
              </EnqueueConfigProvider>
            </SelectionProvider>
          </QueueProvider>
        </SettingsProvider>
      </ConfirmProvider>
    </CliJobsProvider>
  )
}
