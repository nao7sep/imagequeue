import { Layout } from './components/Layout'
import { QueueProvider } from './context/QueueContext'
import './styles.css'

export function App(): React.JSX.Element {
  return (
    <QueueProvider>
      <Layout />
    </QueueProvider>
  )
}
