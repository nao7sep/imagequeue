import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StartupFailureApp } from './components/StartupFailureApp'
import { RendererErrorBoundary } from './components/RendererErrorBoundary'
import { MainProcessLanguage } from './i18n/I18nContext'

const query = new URLSearchParams(window.location.search)
const startupFailure = query.get('surface') === 'startup-failure'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {startupFailure ? (
      <MainProcessLanguage><StartupFailureApp /></MainProcessLanguage>
    ) : (
      <RendererErrorBoundary><MainProcessLanguage><App /></MainProcessLanguage></RendererErrorBoundary>
    )}
  </StrictMode>
)
