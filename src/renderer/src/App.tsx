import { Layout } from './components/Layout'
import { CliJobsPanel } from './components/CliJobsPanel'
import { ConfirmProvider } from './context/ConfirmContext'
import { CliJobsProvider } from './context/CliJobsContext'
import { QueueProvider } from './context/QueueContext'
import { SelectionProvider } from './context/SelectionContext'
import { SettingsProvider } from './context/SettingsContext'
import { AdvancedPromptingProvider } from './context/AdvancedPromptingContext'
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
                <AdvancedPromptingProvider>
                  <Layout />
                  <CliJobsPanel />
                </AdvancedPromptingProvider>
              </EnqueueConfigProvider>
            </SelectionProvider>
          </QueueProvider>
        </SettingsProvider>
      </ConfirmProvider>
    </CliJobsProvider>
  )
}
