import { Modal } from './Modal'
import { BACKEND_LABELS } from '../../../shared/types'
import { getVisibleBackends } from '../utils/visibleBackends'

// Mirror the actual column shortcuts: each visible backend maps to mod+(index+1).
const BACKENDS = getVisibleBackends().map((id) => ({ id, label: BACKEND_LABELS[id] }))

interface Props {
  onClose: () => void
}

export function ShortcutsModal({ onClose }: Props): React.JSX.Element {
  const isMac = window.electronAPI.platform === 'darwin'
  const mod = isMac ? 'Cmd+' : 'Ctrl+'

  return (
    <Modal title="Keyboard Shortcuts" className="shortcuts-modal-box" onClose={onClose}>
      <div className="shortcuts-body">
        <div className="shortcut-group">
          <p className="shortcut-group-name">Sending</p>
          <div className="shortcut-list">
            <div className="shortcut-item"><span>Replace prompt with clipboard text</span><kbd>{mod}P</kbd></div>
            <div className="shortcut-item"><span>Send to all backends</span><kbd>{mod}Enter</kbd></div>
            {BACKENDS.map((backend, index) => (
              <div key={backend.id} className="shortcut-item">
                <span>Send to {backend.label}</span>
                <kbd>{mod}{index + 1}</kbd>
              </div>
            ))}
          </div>
        </div>
        <div className="shortcut-group">
          <p className="shortcut-group-name">Queue Navigation</p>
          <div className="shortcut-list">
            <div className="shortcut-item"><span>Move up / down within column (also in fullscreen viewer)</span><kbd>Up / Down</kbd></div>
            <div className="shortcut-item"><span>Move to nearest task in adjacent column (also in fullscreen viewer)</span><kbd>Left / Right</kbd></div>
            <div className="shortcut-item"><span>Open fullscreen image viewer (Space or Esc to close)</span><kbd>Space</kbd></div>
            <div className="shortcut-item"><span>Remove task, keep selected completed image, or restore selected kept image</span><kbd>Backspace</kbd></div>
            <div className="shortcut-item"><span>Delete task and its files</span><kbd>Delete / {mod}Backspace</kbd></div>
          </div>
        </div>
        <div className="shortcut-group">
          <p className="shortcut-group-name">App</p>
          <div className="shortcut-list">
            <div className="shortcut-item"><span>Settings</span><kbd>{mod}Comma</kbd></div>
            <div className="shortcut-item"><span>Keyboard shortcuts</span><kbd>{mod}/</kbd></div>
            <div className="shortcut-item"><span>Show / hide kept images</span><kbd>{mod}Shift+K</kbd></div>
            <div className="shortcut-item"><span>Close open panel / clear selection</span><kbd>Esc</kbd></div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
