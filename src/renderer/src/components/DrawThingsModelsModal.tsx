import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import './DrawThingsModelsModal.css'
import { useQueue } from '../context/QueueContext'

interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

interface Props {
  onClose: () => void
  onModelsChanged: (downloaded: LocalModelInfo[]) => void
}

export function DrawThingsModelsModal({ onClose, onModelsChanged }: Props): React.JSX.Element {
  const { tasks } = useQueue()
  const [downloadedModels, setDownloadedModels] = useState<LocalModelInfo[]>([])
  const [availableModels, setAvailableModels] = useState<LocalModelInfo[]>([])
  const [loadingDownloaded, setLoadingDownloaded] = useState(true)
  const [loadingAvailable, setLoadingAvailable] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const loadDownloaded = async (): Promise<void> => {
    setLoadingDownloaded(true)
    const list = await window.electronAPI.localListDownloadedModels()
    setDownloadedModels(list)
    setLoadingDownloaded(false)
  }

  useEffect(() => {
    loadDownloaded()
    window.electronAPI.localListAvailableModels().then((list) => {
      setAvailableModels(list)
      setLoadingAvailable(false)
    })
  }, [])

  // Auto-refresh downloaded list when user returns from Terminal
  useEffect(() => {
    const handler = (): void => { loadDownloaded() }
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [])

  const handleDelete = async (modelFile: string): Promise<void> => {
    const isInUse = Object.values(tasks).flat().some(
      (t) => t.backend === 'drawthings' && t.status === 'generating' && t.model === modelFile
    )
    if (isInUse) {
      setDeleteError('Model is in use — wait for the current task to finish.')
      return
    }
    setDeleting(modelFile)
    setDeleteError(null)
    const result = await window.electronAPI.localDeleteModel(modelFile)
    if (result.success) {
      const updated = downloadedModels.filter((m) => m.file !== modelFile)
      setDownloadedModels(updated)
      onModelsChanged(updated)
    } else {
      setDeleteError(result.error ?? 'Deletion failed.')
    }
    setDeleting(null)
  }

  const handleOpenInTerminal = async (modelFile: string): Promise<void> => {
    await window.electronAPI.localOpenTerminalForDownload(modelFile)
  }

  const hfUrl = (hf: string): string =>
    hf.startsWith('http') ? hf : `https://huggingface.co/${hf}`

  const notDownloaded = availableModels.filter((m) => !m.downloaded && !downloadedModels.find((d) => d.file === m.file))
  const filteredDownloaded = downloadedModels.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))
  const filteredNotDownloaded = notDownloaded.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))

  const content = (
    <div className="dt-modal-backdrop" onClick={onClose}>
      <div className="dt-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="dt-modal-header">
          <span>Draw Things Models</span>
          <button className="dt-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="dt-modal-body">
          <div className="dt-search-row">
            <input
              className="dt-search-input"
              placeholder="Search models…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <section className="dt-section">
            <h3 className="dt-section-title">Downloaded</h3>
            {loadingDownloaded ? (
              <p className="dt-hint">Loading…</p>
            ) : downloadedModels.length === 0 ? (
              <p className="dt-hint">No models downloaded yet.</p>
            ) : (
              <ul className="dt-model-list">
                {filteredDownloaded.map((m) => (
                  <li key={m.file} className="dt-model-row">
                    <span className="dt-model-name" title={m.file}>{m.name}</span>
                    <button
                      className="dt-action-btn dt-delete-btn"
                      disabled={deleting !== null}
                      onClick={() => handleDelete(m.file)}
                    >
                      {deleting === m.file ? '…' : 'Delete'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {deleteError && <p className="dt-error">{deleteError}</p>}
          </section>

          <section className="dt-section">
            <h3 className="dt-section-title">Available</h3>
            {loadingAvailable ? (
              <p className="dt-hint">Fetching catalog…</p>
            ) : notDownloaded.length === 0 ? (
              <p className="dt-hint">All available models are already downloaded.</p>
            ) : (
              <ul className="dt-model-list">
                {filteredNotDownloaded.map((m) => (
                  <li key={m.file} className="dt-model-row">
                    <div className="dt-model-info">
                      <span className="dt-model-name" title={m.file}>{m.name}</span>
                      <div className="dt-model-meta">
                        {m.source && m.source !== 'unknown' && (
                          <span className="dt-source-badge">{m.source}</span>
                        )}
                        {m.huggingFace && (
                          <button
                            className="dt-hf-link"
                            title={`Open on HuggingFace: ${m.huggingFace}`}
                            onClick={() => window.electronAPI.openExternal(hfUrl(m.huggingFace!))}
                          >
                            HF ↗
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      className="dt-action-btn dt-download-btn"
                      onClick={() => handleOpenInTerminal(m.file)}
                    >
                      ↓ Terminal
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
