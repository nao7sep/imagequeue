import { Modal } from './Modal'
import { BACKEND_LABELS } from '../../../shared/types'
import { useVisiblePanes } from '../hooks/useVisiblePanes'
import { useI18n } from '../i18n/I18nContext'

// Mirror the actual column shortcuts: each visible backend maps to mod+(index+1).
// Read at render, not at import: hiding an unkeyed provider renumbers the
// columns, and a reference that listed the old numbering would be wrong.

interface Props {
  onClose: () => void
}

export function ShortcutsModal({ onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const isMac = window.electronAPI.platform === 'darwin'
  const mod = isMac ? 'Cmd+' : 'Ctrl+'
  const { backends } = useVisiblePanes()
  const BACKENDS = backends.map((id) => ({ id, label: BACKEND_LABELS[id] }))

  return (
    <Modal
      title={t('shortcuts.title')}
      className="shortcuts-modal-box"
      onClose={onClose}
      footer={
        <button className="modal-btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="shortcuts-body" role="region" aria-label={t('shortcuts.regionLabel')} tabIndex={0}>
        <div className="shortcut-group">
          <p className="shortcut-group-name">{t('shortcuts.sending')}</p>
          <div className="shortcut-list">
            <div className="shortcut-item"><span>{t('shortcuts.pasteReplace')}</span><kbd>{mod}P</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.sendAll')}</span><kbd>{mod}Enter</kbd></div>
            {BACKENDS.map((backend, index) => (
              <div key={backend.id} className="shortcut-item">
                <span>{t('shortcuts.sendTo', { backend: backend.label })}</span>
                <kbd>{mod}{index + 1}</kbd>
              </div>
            ))}
          </div>
        </div>
        <div className="shortcut-group">
          <p className="shortcut-group-name">{t('shortcuts.queueNavigation')}</p>
          <div className="shortcut-list">
            <div className="shortcut-item"><span>{t('shortcuts.tab')}</span><kbd>Tab / Shift+Tab</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.upDown')}</span><kbd>Up/Down</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.leftRight')}</span><kbd>Left/Right</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.homeEnd')}</span><kbd>Home/End</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.space')}</span><kbd>Space</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.backspace')}</span><kbd>Backspace</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.delete')}</span><kbd>Delete / {mod}Backspace</kbd></div>
          </div>
        </div>
        <div className="shortcut-group">
          <p className="shortcut-group-name">{t('shortcuts.app')}</p>
          <div className="shortcut-list">
            <div className="shortcut-item"><span>{t('shortcuts.settings')}</span><kbd>{mod}Comma</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.shortcuts')}</span><kbd>{mod}Slash</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.showKept')}</span><kbd>{mod}Shift+K</kbd></div>
            <div className="shortcut-item"><span>{t('shortcuts.escape')}</span><kbd>Escape</kbd></div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
