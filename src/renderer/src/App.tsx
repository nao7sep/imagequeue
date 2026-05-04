import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { CliJobsPanel } from './components/CliJobsPanel'
import { ConfirmProvider } from './context/ConfirmContext'
import { CliJobsProvider } from './context/CliJobsContext'
import { QueueProvider } from './context/QueueContext'
import { SelectionProvider } from './context/SelectionContext'
import { SettingsProvider } from './context/SettingsContext'
import './styles.css'

const BG_HUE_CYCLE_MS = 12000

export function App(): React.JSX.Element {
  useEffect(() => {
    let frameId = 0
    const root = document.documentElement
    const start = performance.now()

    const updateHue = (now: number): void => {
      const hue = (((now - start) % BG_HUE_CYCLE_MS) / BG_HUE_CYCLE_MS) * 360
      root.style.setProperty('--bg-hue', hue.toFixed(2))
      frameId = requestAnimationFrame(updateHue)
    }

    frameId = requestAnimationFrame(updateHue)
    return () => cancelAnimationFrame(frameId)
  }, [])

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
