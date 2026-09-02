import { Icon } from './Icon'
import './InlineFailureResult.css'

export function InlineFailureResult({ message, closeLabel, onClose }: {
  message: string
  closeLabel: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="inline-failure-result" role="alert">
      <span>{message}</span>
      <button type="button" aria-label={closeLabel} title="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  )
}
