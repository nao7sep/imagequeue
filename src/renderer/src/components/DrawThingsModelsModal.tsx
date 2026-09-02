import { useState, useEffect, useCallback } from 'react'
import { useConfirm } from '../context/ConfirmContext'
import { useCliJobs } from '../context/CliJobsContext'
import { useListbox } from '../hooks/useListbox'
import type { CustomJsonStatus, LocalModelInfo } from '../../../shared/types'
import { Modal } from './Modal'
import { partitionDrawThingsModels } from '../utils/localModels'
import { presentFailure } from '../utils/failurePresentation'
import './DrawThingsModelsModal.css'
import { InlineFailureResult } from './InlineFailureResult'
import { useExternalLinkResults } from '../hooks/useExternalLinkResults'

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
  const [downloadedError, setDownloadedError] = useState('')
  const [availableError, setAvailableError] = useState('')
  const [importPath, setImportPath] = useState('')
  const [importError, setImportError] = useState('')
  const [officialFilter, setOfficialFilter] = useState('')
  const [communityFilter, setCommunityFilter] = useState('')
  // null while the check is in flight. Every operation in this modal runs the
  // CLI (list/import/download all shell out), so without it the modal can do
  // nothing — it shows a pointer to the Dependencies window instead of empty lists.
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null)
  const [cliError, setCliError] = useState('')
  const externalLinks = useExternalLinkResults()

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
    setDownloadedError('')
    try {
      const [list, status] = await Promise.all([
        window.electronAPI.localListDownloadedModels(),
        window.electronAPI.localReadCustomJsonImportedFiles(),
      ])
      setDownloadedModels(list)
      setCustomJsonStatus(status)
    } catch (error) {
      setDownloadedError(presentFailure('drawthings-models-load', error))
    } finally {
      setLoadingDownloaded(false)
    }
  }, [])

  useEffect(() => {
    void window.electronAPI.localCheckCli()
      .then((status) => setCliInstalled(status.installed))
      .catch((error) => setCliError(presentFailure('drawthings-cli-load', error)))
  }, [])

  useEffect(() => {
    if (cliInstalled !== true) return
    void loadDownloaded()
    setLoadingAvailable(true)
    setAvailableError('')
    void window.electronAPI.localListAvailableModels()
      .then(setAvailableModels)
      .catch((error) => setAvailableError(presentFailure('drawthings-catalog-load', error)))
      .finally(() => setLoadingAvailable(false))
  }, [cliInstalled, loadDownloaded])

  // Keep the downloaded list fresh while jobs finish in the background.
  useEffect(() => {
    if (cliInstalled !== true) return
    const handler = (): void => { void loadDownloaded(false) }
    window.addEventListener('focus', handler)
    const id = window.setInterval(handler, 30000)
    return () => {
      window.removeEventListener('focus', handler)
      window.clearInterval(id)
    }
  }, [cliInstalled, loadDownloaded])

  useEffect(() => {
    if (cliInstalled !== true) return
    return window.electronAPI.onCliJobStatus((event) => {
      if (event.status === 'exited' || event.status === 'killed') {
        void loadDownloaded(false)
      }
    })
  }, [cliInstalled, loadDownloaded])

  const handleStartDownload = async (modelFile: string): Promise<void> => {
    setImportError('')
    try {
      const jobId = await window.electronAPI.cliStartDownload(modelFile)
      addJob(jobId, 'download', modelFile)
    } catch (error) {
      setImportError(presentFailure('drawthings-download', error))
    }
  }

  const handleBrowse = async (): Promise<void> => {
    setImportError('')
    try {
      const picked = await window.electronAPI.openFileDialog([])
      if (picked) setImportPath(picked)
    } catch (error) {
      setImportError(presentFailure('drawthings-browse', error))
    }
  }

  const handleImport = async (): Promise<void> => {
    if (!importPath) return
    setImportError('')
    try {
      const jobId = await window.electronAPI.cliStartImport(importPath)
      addJob(jobId, 'import', importPath.split(/[\\/]/).pop() ?? importPath)
      setImportPath('')
    } catch (error) {
      setImportError(presentFailure('drawthings-import', error))
    }
  }

  const loadingModels = loadingDownloaded || loadingAvailable
  const modelsError = downloadedError || availableError
  const allModels = mergeModels(availableModels, downloadedModels)

  // custom.json is the import ground truth (the CLI mislabels every import as
  // source:official). partitionDrawThingsModels splits on it; a custom.json model
  // whose file was deleted is silently dropped rather than shown as a broken
  // official download, and stays re-installable via the Import section below. When
  // custom.json is unreadable we have no ground truth and surface a warning, since a
  // downloaded import may then be misclassified as official.
  const customJsonFiles = customJsonStatus.kind === 'present'
    ? new Set(customJsonStatus.files)
    : null
  const { localImports, catalog } = partitionDrawThingsModels(allModels, customJsonFiles)
  const localImportModels = sortModels(localImports)
  const officialModels = sortCatalogModels(catalog.filter(isOfficialModel))
  const communityCatalogModels = sortCatalogModels(catalog.filter((model) => !isOfficialModel(model)))
  const filteredOfficialModels = officialModels.filter((model) => matchesFilter(model, officialFilter))
  const filteredLocalImportModels = localImportModels.filter((model) => matchesFilter(model, communityFilter))
  const filteredCommunityCatalogModels = communityCatalogModels.filter((model) => matchesFilter(model, communityFilter))

  const renderModelList = (
    models: LocalModelInfo[],
    kind: 'catalog' | 'local',
    label: string,
    emptyText: string
  ): React.JSX.Element => {
    return (
      <DtModelList
        models={loadingModels || modelsError ? [] : models}
        kind={kind}
        label={label}
        loading={loadingModels}
        emptyText={modelsError ? 'Models unavailable.' : emptyText}
        onDownload={(file) => { void handleStartDownload(file) }}
        onOpenExternal={(key, url) => {
          void externalLinks.open({
            key,
            url,
            message: 'The model page could not be opened in your browser. Try the link again.',
            diagnosticMessage: 'Failed to open a Draw Things model link',
          })
        }}
      />
    )
  }

  return (
    <Modal
      title="Draw Things Models"
      // The wide fixed width is for the two model columns. The CLI-required
      // blocked state is just a sentence and a button, so it drops that class and
      // takes the shell's natural (narrower) modal sizing.
      className={cliInstalled === true ? 'dt-modal-box' : undefined}
      onClose={() => { void handleRequestClose() }}
      footer={
        <button className="modal-btn" onClick={() => { void handleRequestClose() }}>
          Close
        </button>
      }
    >
      {cliInstalled !== true ? (
        <div className="dt-modal-body dt-cli-required">
          <p className="dt-hint" role={cliError ? 'alert' : undefined}>
            {cliError
              ? cliError
              : cliInstalled === null
                ? 'Checking the Draw Things CLI…'
                : "The Draw Things CLI is required to list, download, or import models, and it isn't installed yet."}
          </p>
          {cliInstalled === false && <button
            className="dt-action-btn"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('open-dependencies-modal'))
              onClose()
            }}
          >
            Open Managed tools
          </button>}
        </div>
      ) : (
      <div className="dt-modal-body">
        {modelsError && (
          <div className="dt-model-error" role="alert">{modelsError}</div>
        )}
        {Object.entries(externalLinks.results).map(([key, message]) => message ? (
          <InlineFailureResult
            key={key}
            message={message}
            closeLabel="Close model link result"
            onClose={() => externalLinks.dismiss(key)}
          />
        ) : null)}
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
              {renderModelList(
                filteredOfficialModels,
                'catalog',
                'Official models',
                officialModels.length === 0
                  ? 'No official models available.'
                  : 'No official models match this search.'
              )}
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
                    placeholder="Model file path"
                    value={importPath}
                    onChange={(e) => { setImportError(''); setImportPath(e.target.value) }}
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
                {importError && <div className="dt-model-error" role="alert">{importError}</div>}
              </section>

              <section className="dt-section">
                <h4 className="dt-section-title">Local Imports</h4>
                {customJsonStatus.kind === 'unreadable' && (
                  <p className="dt-hint" role="alert">
                    {customJsonStatus.category === 'invalid-format'
                      ? <>Draw Things&apos; <code>custom.json</code> has an unsupported format.</>
                      : <>Draw Things&apos; <code>custom.json</code> could not be read.</>}
                    {' '}Any imported models may currently be listed under Official Models until this file is repaired.
                  </p>
                )}
                {renderModelList(
                  filteredLocalImportModels,
                  'local',
                  'Local imports',
                  localImportModels.length === 0
                    ? 'No local imports detected.'
                    : 'No local imports match this search.'
                )}
              </section>

              <section className="dt-section">
                <h4 className="dt-section-title">Community Catalog</h4>
                {renderModelList(
                  filteredCommunityCatalogModels,
                  'catalog',
                  'Community catalog',
                  communityCatalogModels.length === 0
                    ? 'No community catalog models available.'
                    : 'No community models match this search.'
                )}
              </section>
            </div>
          </section>
        </div>
      </div>
      )}
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
  loading,
  emptyText,
  onDownload,
  onOpenExternal,
}: {
  models: LocalModelInfo[]
  kind: 'catalog' | 'local'
  label: string
  loading: boolean
  emptyText: string
  onDownload: (file: string) => void
  onOpenExternal: (key: string, url: string) => void
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
    <ul className="dt-model-list" aria-label={label} aria-busy={loading} {...listboxProps}>
      {models.length === 0 && (
        <li className="dt-hint" role="presentation">{loading ? 'Loading models…' : emptyText}</li>
      )}
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
                  onClick={() => onOpenExternal(`hugging-face:${model.file}`, hfUrl(model.huggingFace!))}
                >
                  Hugging Face
                </button>
              )}
              <button
                tabIndex={-1}
                className="dt-text-link dt-text-link-google"
                title={`Search Google for ${modelName(model)}`}
                onClick={() => onOpenExternal(`google:${model.file}`, googleSearchUrl(model))}
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
