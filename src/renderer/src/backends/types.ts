import type { ModelDef } from '../../../shared/models'

export interface BackendControlsProps<P extends Record<string, unknown>, M extends ModelDef> {
  params: P
  modelDef: M
  onChange: (next: P) => void
}

// One parameter model per cloud backend — the single home for everything that
// used to fork per backend across QueueColumn (state slots, the clamp-on-model-
// change effect, the enqueue payload) and utils/imageBackendDefaults (the saved-
// defaults resolver). "Is this value valid for this model?" is answered here,
// once per backend, instead of being re-spelled at each of those sites and
// drifting.
//
// P is the UI-shaped params object the column holds in one useState; M is the
// backend's own ModelDef subtype. Draw Things is deliberately NOT a descriptor:
// its column drives a local CLI with per-model persisted params and
// recommendations — a different lifecycle, not a wider parameter set.
export interface BackendParamModel<P extends Record<string, unknown>, M extends ModelDef> {
  /** Initial params before any saved defaults apply — the column's mount state. */
  defaults(): P

  /**
   * Re-validate params after a model switch. A value the new model does not
   * offer falls to the new model's own default — the old value belonged to the
   * previous model, so nothing about it is worth preserving (this is why a
   * ranged value out of the new range takes the range default rather than
   * clamping: contrast with fromSaved).
   */
  clampToModel(params: P, modelDef: M): P

  /**
   * Resolve a saved `default_params` record (untrusted, possibly stale) into
   * valid params for `modelDef`. Unlike clampToModel this treats the incoming
   * values as user data: a saved number outside a range clamps to the nearest
   * bound instead of resetting, and a missing value takes the model's default.
   */
  fromSaved(saved: Record<string, unknown>, modelDef: M): P

  /**
   * The request-shaped payload for enqueueing — also the canonical form the
   * defaults autosave serializes for its dirty comparison, so key order here is
   * load-bearing: it must be stable, and the saved-defaults path must produce
   * the identical serialization (see the descriptor round-trip tests).
   */
  toEnqueueParams(params: P, modelDef: M): Record<string, unknown>

  /** The column's parameter rows for this backend (`.setting-row` markup). */
  Controls: (props: BackendControlsProps<P, M>) => React.JSX.Element
}
