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

export function DrawThingsModelsModal({ onClose }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const [downloadedModels, setDownloadedModels] = useState<LocalModelInfo[]>([])
  const [availableModels, setAvailableModels] = useState<LocalModelInfo[]>([])
  const [loadingDownloaded, setLoadingDownloaded] = useState(true)
  const [loadingAvailable, setLoadingAvailable] = useState(true)
  const [openedTerminal, setOpenedTerminal] = useState<string | null>(null)
  const [importPath, setImportPath] = useState('')
  const [filter, setFilter] = useState('')

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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void handleRequestClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleRequestClose])

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

  const handleOpenInTerminal = async (modelFile: string): Promise<void> => {
    await window.electronAPI.localOpenTerminalForDownload(modelFile)
    setOpenedTerminal(modelFile)
    setTimeout(() => setOpenedTerminal(null), 1500)
  }

  const [dragging, setDragging] = useState(false)

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.electronAPI.openFileDialog([
      { name: 'Model files', extensions: ['safetensors', 'ckpt', 'pth', 'pt', 'bin', 'zip'] }
    ])
    if (picked) setImportPath(picked)
  }

  const handleImport = async (): Promise<void> => {
    if (!importPath) return
    await window.electronAPI.localOpenTerminalForImport(importPath)
    setOpenedTerminal(importPath)
    setTimeout(() => setOpenedTerminal(null), 1500)
  }

  const hfUrl = (hf: string): string =>
    hf.startsWith('http') ? hf : `https://huggingface.co/${hf}`

  const notDownloaded = availableModels.filter((m) => !m.downloaded && !downloadedModels.find((d) => d.file === m.file))
  const filteredDownloaded = downloadedModels.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))
  const filteredNotDownloaded = notDownloaded.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))

  const content = (
    <div className="dt-modal-backdrop" onClick={() => void handleRequestClose()}>
      <div className="dt-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="dt-modal-header">
          <span>Draw Things Models</span>
          <button className="dt-modal-close" onClick={() => void handleRequestClose()}>✕</button>
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
              <p className="dt-hint">No models downloaded yet</p>
            ) : (
              <ul className="dt-model-list">
                {filteredDownloaded.map((m) => (
                  <li key={m.file} className="dt-model-row">
                    <div className="dt-model-info">
                      <span className="dt-model-name" title={m.file}>{m.name}</span>
                      <div className="dt-model-meta">
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
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dt-section">
            <h3 className="dt-section-title">Import</h3>
            <p className="dt-hint" style={{ marginBottom: 8 }}>
              Select a local model file to import into Draw Things format.
            </p>
            <div
              className={`dt-import-drop${dragging ? ' dt-import-drop--active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragging(false)
                const file = e.dataTransfer.files[0]
                if (file) setImportPath(window.electronAPI.getPathForFile(file))
              }}
            >
              <div className="dt-import-row">
                <input
                  className="dt-import-input"
                  placeholder="Drop a file or browse…"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                />
                <button className="dt-action-btn dt-browse-btn" onClick={handleBrowse}>Browse…</button>
                <button
                  className="dt-action-btn dt-import-btn"
                  disabled={!importPath}
                  onClick={handleImport}
                >
                  {openedTerminal === importPath ? '✓ opened' : '→ Import'}
                </button>
              </div>
            </div>
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
                      {openedTerminal === m.file ? '✓ opened' : '↓ Download'}
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
