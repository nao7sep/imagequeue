import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useConfirm } from '../context/ConfirmContext'
import './DrawThingsModelsModal.css'

interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

interface Props {
  onClose: () => void
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function modelName(model: LocalModelInfo): string {
  return model.name || model.file
}

function modelSortKey(model: LocalModelInfo): string {
  return `${modelName(model)} ${model.file}`.toLowerCase()
}

function sortModels(models: LocalModelInfo[]): LocalModelInfo[] {
  return [...models].sort((a, b) => collator.compare(modelSortKey(a), modelSortKey(b)))
}

function sortCatalogModels(models: LocalModelInfo[]): LocalModelInfo[] {
  return [...models].sort((a, b) => {
    if (a.downloaded !== b.downloaded) return a.downloaded ? -1 : 1
    return collator.compare(modelSortKey(a), modelSortKey(b))
  })
}

function matchesFilter(model: LocalModelInfo, filter: string): boolean {
  const q = filter.trim().toLowerCase()
  if (!q) return true
  return `${modelName(model)} ${model.file}`.toLowerCase().includes(q)
}

function normalizedSource(model: LocalModelInfo): string {
  return model.source.trim().toLowerCase()
}

function isOfficialModel(model: LocalModelInfo): boolean {
  return normalizedSource(model) === 'official'
}

function sourceLabel(model: LocalModelInfo): string {
  const source = model.source.trim()
  if (!source || source.toLowerCase() === 'unknown') return 'Catalog'
  return source.replace(/[_-]/g, ' ')
}

function withoutExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '')
}

function looksLikeLocalImport(model: LocalModelInfo): boolean {
  const name = model.name.trim()
  const file = model.file.trim()
  if (!name) return true

  const nameLower = name.toLowerCase()
  const fileStemLower = withoutExtension(file).toLowerCase()
  const sameAsFileStem = nameLower === fileStemLower
  const hasUnderscore = name.includes('_') || file.includes('_')
  const hasNoSpaces = !/\s/.test(name)
  const looksTitleLike = /\s/.test(name) && /[A-Z]/.test(name)

  return sameAsFileStem || (hasUnderscore && hasNoSpaces && !looksTitleLike)
}

function mergeModelInfo(primary: LocalModelInfo, secondary: LocalModelInfo): LocalModelInfo {
  return {
    file: primary.file || secondary.file,
    name: primary.name || secondary.name,
    source: primary.source && primary.source !== 'unknown' ? primary.source : secondary.source,
    downloaded: primary.downloaded || secondary.downloaded,
    huggingFace: primary.huggingFace ?? secondary.huggingFace
  }
}

function mergeModels(availableModels: LocalModelInfo[], downloadedModels: LocalModelInfo[]): LocalModelInfo[] {
  const byFile = new Map<string, LocalModelInfo>()

  for (const model of availableModels) {
    byFile.set(model.file, model)
  }
  for (const model of downloadedModels) {
    const existing = byFile.get(model.file)
    byFile.set(model.file, existing ? mergeModelInfo(existing, model) : model)
  }

  return [...byFile.values()]
}

export function DrawThingsModelsModal({ onClose }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const [downloadedModels, setDownloadedModels] = useState<LocalModelInfo[]>([])
  const [availableModels, setAvailableModels] = useState<LocalModelInfo[]>([])
  const [loadingDownloaded, setLoadingDownloaded] = useState(true)
  const [loadingAvailable, setLoadingAvailable] = useState(true)
  const [openedTerminal, setOpenedTerminal] = useState<string | null>(null)
  const [importPath, setImportPath] = useState('')
  const [officialFilter, setOfficialFilter] = useState('')
  const [communityFilter, setCommunityFilter] = useState('')

  const handleRequestClose = useCallback(async (): Promise<void> => {
    if (importPath.trim() === '') {
      onClose()
      return
    }
    const ok = await confirm({
      title: 'Unsaved changes',
      message: 'You have an unimported model path. Discard and close?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep Editing',
      danger: true
    })
    if (ok) onClose()
  }, [importPath, confirm, onClose])

  // Close on Escape; stop propagation so app-level selection handlers
  // don't clear the preview underneath this portal modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (document.querySelector('.modal-backdrop')) return
      e.preventDefault()
      e.stopPropagation()
      void handleRequestClose()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [handleRequestClose])

  const loadDownloaded = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) setLoadingDownloaded(true)
    try {
      const list = await window.electronAPI.localListDownloadedModels()
      setDownloadedModels(list)
    } finally {
      setLoadingDownloaded(false)
    }
  }, [])

  useEffect(() => {
    void loadDownloaded()
    window.electronAPI.localListAvailableModels().then((list) => {
      setAvailableModels(list)
      setLoadingAvailable(false)
    })
  }, [loadDownloaded])

  // Auto-refresh downloaded list while Terminal-side imports/downloads may finish.
  useEffect(() => {
    const handler = (): void => { void loadDownloaded(false) }
    window.addEventListener('focus', handler)
    const id = window.setInterval(handler, 30000)
    return () => {
      window.removeEventListener('focus', handler)
      window.clearInterval(id)
    }
  }, [loadDownloaded])

  const handleOpenInTerminal = async (modelFile: string): Promise<void> => {
    await window.electronAPI.localOpenTerminalForDownload(modelFile)
    setOpenedTerminal(modelFile)
    setTimeout(() => setOpenedTerminal(null), 1500)
  }

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.electronAPI.openFileDialog([])
    if (picked) setImportPath(picked)
  }

  const handleImport = async (): Promise<void> => {
    if (!importPath) return
    const openedPath = importPath
    await window.electronAPI.localOpenTerminalForImport(openedPath)
    setImportPath('')
    setOpenedTerminal(openedPath)
    setTimeout(() => setOpenedTerminal(null), 1500)
  }

  const hfUrl = (hf: string): string =>
    hf.startsWith('http') ? hf : `https://huggingface.co/${hf}`

  const googleSearchUrl = (model: LocalModelInfo): string =>
    `https://www.google.com/search?q=${encodeURIComponent(modelName(model))}`

  const loadingModels = loadingDownloaded || loadingAvailable
  const allModels = mergeModels(availableModels, downloadedModels)
  const localImportFiles = new Set(
    allModels
      .filter((model) => model.downloaded && looksLikeLocalImport(model))
      .map((model) => model.file)
  )
  const catalogModels = allModels.filter((model) => !localImportFiles.has(model.file))
  const localImportModels = sortModels(allModels.filter((model) => localImportFiles.has(model.file)))
  const officialModels = sortCatalogModels(catalogModels.filter(isOfficialModel))
  const communityCatalogModels = sortCatalogModels(catalogModels.filter((model) => !isOfficialModel(model)))
  const filteredOfficialModels = officialModels.filter((model) => matchesFilter(model, officialFilter))
  const filteredLocalImportModels = localImportModels.filter((model) => matchesFilter(model, communityFilter))
  const filteredCommunityCatalogModels = communityCatalogModels.filter((model) => matchesFilter(model, communityFilter))

  const renderModelMeta = (model: LocalModelInfo, kind: 'catalog' | 'local'): React.JSX.Element => (
    <div className="dt-model-meta">
      <span className="dt-source-badge">{kind === 'local' ? 'local import' : sourceLabel(model)}</span>
      {model.huggingFace && (
        <button
          className="dt-text-link"
          title={`Open on Hugging Face: ${model.huggingFace}`}
          onClick={() => window.electronAPI.openExternal(hfUrl(model.huggingFace!))}
        >
          Hugging Face
        </button>
      )}
      <button
        className="dt-text-link dt-text-link-google"
        title={`Search Google for ${modelName(model)}`}
        onClick={() => window.electronAPI.openExternal(googleSearchUrl(model))}
      >
        Google
      </button>
    </div>
  )

  const renderModelRow = (model: LocalModelInfo, kind: 'catalog' | 'local'): React.JSX.Element => (
    <li key={`${kind}-${model.file}`} className="dt-model-row">
      <div className="dt-model-info">
        <span className="dt-model-name" title={model.file}>{modelName(model)}</span>
        {renderModelMeta(model, kind)}
      </div>
      {kind === 'local' || model.downloaded ? (
        <span className="dt-status-badge">Installed</span>
      ) : (
        <button
          className="dt-action-btn dt-download-btn"
          onClick={() => handleOpenInTerminal(model.file)}
        >
          {openedTerminal === model.file ? 'Opened' : 'Download'}
        </button>
      )}
    </li>
  )

  const renderModelList = (
    models: LocalModelInfo[],
    kind: 'catalog' | 'local',
    emptyText: string
  ): React.JSX.Element => {
    if (loadingModels) return <p className="dt-hint">Loading models...</p>
    if (models.length === 0) return <p className="dt-hint">{emptyText}</p>
    return (
      <ul className="dt-model-list">
        {models.map((model) => renderModelRow(model, kind))}
      </ul>
    )
  }

  const content = (
    <div
      className="dt-modal-backdrop"
      onClick={() => void handleRequestClose()}
    >
      <div
        className="dt-modal-box"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dt-modal-header">
          <span>Draw Things Models</span>
          <button className="dt-modal-close" onClick={() => void handleRequestClose()}>✕</button>
        </div>

        <div className="dt-modal-body">
          <div className="dt-model-columns">
            <section className="dt-model-column">
              <div className="dt-column-header">
                <h3 className="dt-column-title">Official Models</h3>
                <p className="dt-column-desc">Install models from the Draw Things official catalog.</p>
                <input
                  className="dt-search-input"
                  placeholder="Search official models..."
                  value={officialFilter}
                  onChange={(e) => setOfficialFilter(e.target.value)}
                />
              </div>
              <div className="dt-column-scroll">
                {renderModelList(filteredOfficialModels, 'catalog', 'No official models found.')}
              </div>
            </section>

            <section className="dt-model-column">
              <div className="dt-column-header">
                <h3 className="dt-column-title">Community Models</h3>
                <p className="dt-column-desc">Download community catalog models or import local files.</p>
                <input
                  className="dt-search-input"
                  placeholder="Search community models..."
                  value={communityFilter}
                  onChange={(e) => setCommunityFilter(e.target.value)}
                />
              </div>
              <div className="dt-column-scroll">
                <section className="dt-section dt-import-section">
                  <h4 className="dt-section-title">Import Local Model</h4>
                  <p className="dt-hint dt-import-hint">
                    Import a model artifact from this computer into the Draw Things models directory.
                  </p>
                  <div className="dt-import-row">
                    <input
                      className="dt-import-input"
                      placeholder="Model file path"
                      value={importPath}
                      onChange={(e) => setImportPath(e.target.value)}
                    />
                    <button className="dt-action-btn dt-browse-btn" onClick={handleBrowse}>Browse...</button>
                    <button
                      className="dt-action-btn dt-import-btn"
                      disabled={!importPath}
                      onClick={handleImport}
                    >
                      {openedTerminal === importPath ? 'Opened' : 'Import'}
                    </button>
                  </div>
                </section>

                <section className="dt-section">
                  <h4 className="dt-section-title">Local Imports</h4>
                  {renderModelList(filteredLocalImportModels, 'local', 'No local imports detected.')}
                </section>

                <section className="dt-section">
                  <h4 className="dt-section-title">Community Catalog</h4>
                  {renderModelList(filteredCommunityCatalogModels, 'catalog', 'No community models found.')}
                </section>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
