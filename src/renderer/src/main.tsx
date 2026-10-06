import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StartupFailureApp } from './components/StartupFailureApp'
import { RendererErrorBoundary } from './components/RendererErrorBoundary'
import { MainProcessLanguage } from './i18n/I18nContext'
import { RecordsApp } from './records/RecordsWindow'
import { FullscreenViewApp } from './viewing/FullscreenView'
import { PreviewWindowApp } from './viewing/PreviewWindow'

const query = new URLSearchParams(window.location.search)
const surface = query.get('surface')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {surface === 'startup-failure' ? (
      <MainProcessLanguage><StartupFailureApp /></MainProcessLanguage>
    ) : surface === 'records' ? (
      <RendererErrorBoundary><MainProcessLanguage><RecordsApp /></MainProcessLanguage></RendererErrorBoundary>
    ) : surface === 'preview-window' ? (
      <RendererErrorBoundary><MainProcessLanguage><PreviewWindowApp /></MainProcessLanguage></RendererErrorBoundary>
    ) : surface === 'fullscreen-view' ? (
      <RendererErrorBoundary><MainProcessLanguage><FullscreenViewApp /></MainProcessLanguage></RendererErrorBoundary>
    ) : (
      <RendererErrorBoundary><MainProcessLanguage><App /></MainProcessLanguage></RendererErrorBoundary>
    )}
  </StrictMode>
)
