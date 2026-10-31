import type { ModelDef } from '../../../shared/models'

export interface BackendControlsProps<P extends Record<string, unknown>, M extends ModelDef> {
  params: P
  modelDef: M
  onChange: (next: P) => void
}

// One parameter model per cloud backend — the single home for what QueueColumn
// (state slots, the model-change effect, the enqueue payload) and
// utils/backendParams (the saved-parameters resolver) need per backend. "Is this
// value valid for this model?" is answered here, once per backend, instead of
// being re-spelled at each of those sites and drifting.
//
// P is the UI-shaped params object the column holds in one useState; M is the
// backend's own ModelDef subtype. Draw Things is deliberately NOT a descriptor:
// its column drives a local CLI with per-model persisted params and
// recommendations — a different lifecycle, not a wider parameter set.
export interface BackendParamModel<P extends Record<string, unknown>, M extends ModelDef> {
  /** Initial params before any saved parameters apply — the column's mount state. */
  defaults(): P

  /**
   * Re-validate params after a model switch. A choice the new model does not
   * offer falls to the new model's own default; typed number text is kept, and
   * its field shows an error when the new model's range does not take it.
   */
  clampToModel(params: P, modelDef: M): P

  /**
   * Resolve a saved parameter record into params for `modelDef`. A choice the
   * model does not offer, or a missing value, takes the model's default; a saved
   * number, which backend-params.json has already checked, is shown as it is.
   */
  fromSaved(saved: Record<string, unknown>, modelDef: M): P

  /**
   * The request-shaped payload, or null while a field is invalid — also the canonical form the
   * parameters autosave serializes for its dirty comparison, so key order here is
   * load-bearing: it must be stable, and the saved-parameters path must produce
   * the identical serialization (see the descriptor round-trip tests).
   */
  toEnqueueParams(params: P, modelDef: M): Record<string, unknown> | null

  /** The column's parameter rows for this backend (`.setting-row` markup). */
  Controls: (props: BackendControlsProps<P, M>) => React.JSX.Element
}
