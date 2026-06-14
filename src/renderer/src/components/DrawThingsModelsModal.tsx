import { useState, useEffect, useCallback } from 'react'
import { useConfirm } from '../context/ConfirmContext'
import { useCliJobs } from '../context/CliJobsContext'
import { useListbox } from '../hooks/useListbox'
import type { CustomJsonStatus } from '../../../shared/types'
import { Modal } from './Modal'
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

function hfUrl(hf: string): string {
  return hf.startsWith('http') ? hf : `https://huggingface.co/${hf}`
}

function googleSearchUrl(model: LocalModelInfo): string {
  return `https://www.google.com/search?q=${encodeURIComponent(modelName(model))}`
}

function isDownloadable(model: LocalModelInfo, kind: 'catalog' | 'local'): boolean {
  return kind !== 'local' && !model.downloaded
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
  const { addJob } = useCliJobs()
  const [downloadedModels, setDownloadedModels] = useState<LocalModelInfo[]>([])
  const [availableModels, setAvailableModels] = useState<LocalModelInfo[]>([])
  const [customJsonStatus, setCustomJsonStatus] = useState<CustomJsonStatus>({ kind: 'absent' })
  const [loadingDownloaded, setLoadingDownloaded] = useState(true)
  const [loadingAvailable, setLoadingAvailable] = useState(true)
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

  const loadDownloaded = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) setLoadingDownloaded(true)
    try {
      const [list, status] = await Promise.all([
        window.electronAPI.localListDownloadedModels(),
        window.electronAPI.localReadCustomJsonImportedFiles(),
      ])
      setDownloadedModels(list)
      setCustomJsonStatus(status)
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

  // Keep the downloaded list fresh while jobs finish in the background.
  useEffect(() => {
    const handler = (): void => { void loadDownloaded(false) }
    window.addEventListener('focus', handler)
    const id = window.setInterval(handler, 30000)
    return () => {
      window.removeEventListener('focus', handler)
      window.clearInterval(id)
    }
  }, [loadDownloaded])

  useEffect(() => {
    return window.electronAPI.onCliJobStatus((event) => {
      if (event.status === 'exited' || event.status === 'killed') {
        void loadDownloaded(false)
      }
    })
  }, [loadDownloaded])

  const handleStartDownload = async (modelFile: string): Promise<void> => {
    const jobId = await window.electronAPI.cliStartDownload(modelFile)
    addJob(jobId, 'download', modelFile)
  }

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.electronAPI.openFileDialog([])
    if (picked) setImportPath(picked)
  }

  const handleImport = async (): Promise<void> => {
    if (!importPath) return
    const jobId = await window.electronAPI.cliStartImport(importPath)
    addJob(jobId, 'import', importPath.split(/[\\/]/).pop() ?? importPath)
    setImportPath('')
  }

  const loadingModels = loadingDownloaded || loadingAvailable
  const allModels = mergeModels(availableModels, downloadedModels)

  // `custom.json` is the only fully trustworthy signal here: draw-things-cli
  // reports `source: official` for every entry in custom.json, so its source
  // column on its own cannot distinguish a downloaded import from a real
  // official catalog download.
  //
  // - present: use the file set as ground truth.
  // - absent: no imports exist yet (fresh install, or no imports ever made),
  //   so the CLI's source column is safe to trust.
  // - unreadable: custom.json is there but we can't parse it. We still
  //   trust the CLI rather than flooding Local Imports with downloaded
  //   official models, but we surface a warning so the user knows imports
  //   in this state may be misclassified.
  const customJsonFiles = customJsonStatus.kind === 'present'
    ? new Set(customJsonStatus.files)
    : null
  const localImportFiles = new Set(
    allModels
      .filter((model) => {
        if (!model.downloaded) return false
        if (customJsonFiles === null) return false
        return customJsonFiles.has(model.file)
      })
      .map((model) => model.file)
  )
  const catalogModels = allModels.filter((model) => !localImportFiles.has(model.file))
  const localImportModels = sortModels(allModels.filter((model) => localImportFiles.has(model.file)))
  const officialModels = sortCatalogModels(catalogModels.filter(isOfficialModel))
  const communityCatalogModels = sortCatalogModels(catalogModels.filter((model) => !isOfficialModel(model)))
  const filteredOfficialModels = officialModels.filter((model) => matchesFilter(model, officialFilter))
  const filteredLocalImportModels = localImportModels.filter((model) => matchesFilter(model, communityFilter))
  const filteredCommunityCatalogModels = communityCatalogModels.filter((model) => matchesFilter(model, communityFilter))

  const renderModelList = (
    models: LocalModelInfo[],
    kind: 'catalog' | 'local',
    label: string,
    emptyText: string
  ): React.JSX.Element => {
    if (loadingModels) return <p className="dt-hint">Loading models...</p>
    if (models.length === 0) return <p className="dt-hint">{emptyText}</p>
    return (
      <DtModelList
        models={models}
        kind={kind}
        label={label}
        onDownload={(file) => { void handleStartDownload(file) }}
      />
    )
  }

  return (
    <Modal
      title="Draw Things Models"
      className="dt-modal-box"
      onClose={() => { void handleRequestClose() }}
    >
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
              {renderModelList(filteredOfficialModels, 'catalog', 'Official models', 'No official models found.')}
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
                    onClick={() => { void handleImport() }}
                  >
                    Import
                  </button>
                </div>
              </section>

              <section className="dt-section">
                <h4 className="dt-section-title">Local Imports</h4>
                {customJsonStatus.kind === 'unreadable' && (
                  <p className="dt-hint">
                    Couldn&apos;t read <code>custom.json</code> ({customJsonStatus.reason}). Any imported models may currently be listed under Official Models until this file can be parsed.
                  </p>
                )}
                {renderModelList(filteredLocalImportModels, 'local', 'Local imports', 'No local imports detected.')}
              </section>

              <section className="dt-section">
                <h4 className="dt-section-title">Community Catalog</h4>
                {renderModelList(filteredCommunityCatalogModels, 'catalog', 'Community catalog', 'No community models found.')}
              </section>
            </div>
          </section>
        </div>
      </div>
    </Modal>
  )
}

// One model list as a composite listbox. Manual activation: arrowing moves the
// active row; Enter downloads a downloadable row (Download is a network action,
// so it never fires merely on focus). Type-ahead is ceded — the column's search
// input owns the letter keys. The Download button and the Hugging Face / Google
// links are pointer-only (tabIndex -1), never tab stops inside the listbox.
function DtModelList({
  models,
  kind,
  label,
  onDownload,
}: {
  models: LocalModelInfo[]
  kind: 'catalog' | 'local'
  label: string
  onDownload: (file: string) => void
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { listboxProps, getOptionProps } = useListbox<HTMLUListElement>({
    ids: models.map((m) => m.file),
    selectedId,
    onSelect: setSelectedId,
    activation: 'manual',
    onPrimary: (file) => {
      const model = models.find((m) => m.file === file)
      if (model && isDownloadable(model, kind)) onDownload(file)
    },
    typeAhead: false,
  })

  return (
    <ul className="dt-model-list" aria-label={label} {...listboxProps}>
      {models.map((model) => (
        <li
          key={`${kind}-${model.file}`}
          className={`dt-model-row${selectedId === model.file ? ' selected' : ''}`}
          {...getOptionProps(model.file)}
        >
          <div className="dt-model-info">
            <span className="dt-model-name" title={model.file}>{modelName(model)}</span>
            <div className="dt-model-meta">
              <span className="dt-source-badge">{kind === 'local' ? 'local import' : sourceLabel(model)}</span>
              {model.huggingFace && (
                <button
                  tabIndex={-1}
                  className="dt-text-link"
                  title={`Open on Hugging Face: ${model.huggingFace}`}
                  onClick={() => window.electronAPI.openExternal(hfUrl(model.huggingFace!))}
                >
                  Hugging Face
                </button>
              )}
              <button
                tabIndex={-1}
                className="dt-text-link dt-text-link-google"
                title={`Search Google for ${modelName(model)}`}
                onClick={() => window.electronAPI.openExternal(googleSearchUrl(model))}
              >
                Google
              </button>
            </div>
          </div>
          {isDownloadable(model, kind) ? (
            <button
              tabIndex={-1}
              className="dt-action-btn dt-download-btn"
              onClick={() => onDownload(model.file)}
            >
              Download
            </button>
          ) : (
            <span className="dt-status-badge">Installed</span>
          )}
        </li>
      ))}
    </ul>
  )
}
