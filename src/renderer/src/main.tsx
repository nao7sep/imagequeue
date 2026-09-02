import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StartupFailureApp } from './components/StartupFailureApp'
import { STARTUP_FAILURE_MESSAGE } from '../../shared/startup-failure'

const query = new URLSearchParams(window.location.search)
const startupFailure = query.get('surface') === 'startup-failure'
const startupFailureMessage = query.get('message') ?? STARTUP_FAILURE_MESSAGE

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {startupFailure ? <StartupFailureApp message={startupFailureMessage} /> : <App />}
  </StrictMode>
)
