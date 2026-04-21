import { Layout } from './components/Layout'
import { QueueProvider } from './context/QueueContext'
import { SettingsProvider } from './context/SettingsContext'
import './styles.css'

export function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <QueueProvider>
        <Layout />
      </QueueProvider>
    </SettingsProvider>
  )
}
