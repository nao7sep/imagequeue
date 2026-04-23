import { Layout } from './components/Layout'
import { ConfirmProvider } from './context/ConfirmContext'
import { QueueProvider } from './context/QueueContext'
import { SelectionProvider } from './context/SelectionContext'
import { SettingsProvider } from './context/SettingsContext'
import './styles.css'

export function App(): React.JSX.Element {
  return (
    <ConfirmProvider>
      <SettingsProvider>
        <QueueProvider>
          <SelectionProvider>
            <Layout />
          </SelectionProvider>
        </QueueProvider>
      </SettingsProvider>
    </ConfirmProvider>
  )
}
