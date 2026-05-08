import { Layout } from './components/Layout'
import { CliJobsPanel } from './components/CliJobsPanel'
import { ConfirmProvider } from './context/ConfirmContext'
import { CliJobsProvider } from './context/CliJobsContext'
import { QueueProvider } from './context/QueueContext'
import { SelectionProvider } from './context/SelectionContext'
import { SettingsProvider } from './context/SettingsContext'
import './styles.css'

export function App(): React.JSX.Element {
  return (
    <CliJobsProvider>
      <ConfirmProvider>
        <SettingsProvider>
          <QueueProvider>
            <SelectionProvider>
              <Layout />
              <CliJobsPanel />
            </SelectionProvider>
          </QueueProvider>
        </SettingsProvider>
      </ConfirmProvider>
    </CliJobsProvider>
  )
}
