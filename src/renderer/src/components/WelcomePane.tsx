import './WelcomePane.css'

interface Props {
  onOpenSettings: () => void
}

// Stands in the right-hand pane group when it would otherwise be empty: no cloud
// backend has a key, and this platform has no Draw Things column to fall back on.
// It occupies one column slot, and it is not a backend — it holds no tasks and
// takes no part in column shortcuts or selection navigation.
//
// It says nothing about Draw Things. macOS always shows that column, so this pane
// is unreachable there; the only users who see it are on a platform Draw Things
// does not run on, and offering them a Mac-only backend would be noise.
export function WelcomePane({ onOpenSettings }: Props): React.JSX.Element {
  return (
    <div className="welcome-pane">
      <div className="column-header">Getting started</div>
      <div className="welcome-body">
        <p className="welcome-lead">
          ImageQueue generates images through providers you supply. Nothing is configured yet.
        </p>

        <div className="welcome-step">
          <div className="welcome-step-title">Add a provider key</div>
          <p>
            OpenAI, Nano Banana, Grok, and FLUX each need their own API key from that provider.
            A column appears here for every key you add.
          </p>
          <button className="welcome-btn welcome-btn-primary" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>

      </div>
    </div>
  )
}
