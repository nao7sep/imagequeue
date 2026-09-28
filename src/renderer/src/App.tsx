import { Layout } from './components/Layout'
import { ToastStack } from './components/ToastStack'
import { ResumeInterruptedPrompt } from './components/ResumeInterruptedPrompt'
import { ConfirmProvider } from './context/ConfirmContext'
import { CliJobsProvider } from './context/CliJobsContext'
import { QueueProvider } from './context/QueueContext'
import { SelectionProvider } from './context/SelectionContext'
import { SettingsProvider } from './context/SettingsContext'
import { SessionDraftProvider } from './context/SessionDraftContext'
import { EnqueueConfigProvider } from './context/EnqueueConfigContext'
import { UiStateProvider } from './context/UiStateContext'
import { DependenciesProvider } from './context/DependenciesContext'
import './styles.css'

export function App(): React.JSX.Element {
  return (
    <DependenciesProvider>
      <CliJobsProvider>
        <ConfirmProvider>
          <UiStateProvider>
            <SettingsProvider>
              <QueueProvider>
                <SelectionProvider>
                  <EnqueueConfigProvider>
                    <SessionDraftProvider>
                      <Layout />
                      <ToastStack />
                      <ResumeInterruptedPrompt />
                    </SessionDraftProvider>
                  </EnqueueConfigProvider>
                </SelectionProvider>
              </QueueProvider>
            </SettingsProvider>
          </UiStateProvider>
        </ConfirmProvider>
      </CliJobsProvider>
    </DependenciesProvider>
  )
}
