// Shared types between main and renderer processes.

import type { SessionDraft } from './session-draft'

export type BackendId = 'openai' | 'nanobanana' | 'grok' | 'flux' | 'drawthings'
export type CloudBackendId = Exclude<BackendId, 'drawthings'>

export const BACKEND_IDS_IN_UI_ORDER: BackendId[] = [
  'openai',
  'nanobanana',
  'grok',
  'flux',
  'drawthings'
]

export const CLOUD_BACKEND_IDS_IN_UI_ORDER = BACKEND_IDS_IN_UI_ORDER.filter(
  (backend): backend is CloudBackendId => backend !== 'drawthings'
)

export const BACKEND_LABELS: Record<BackendId, string> = {
  openai: 'GPT Image',
  nanobanana: 'Nano Banana',
  grok: 'Grok Imagine',
  flux: 'FLUX',
  drawthings: 'Draw Things'
}

export interface CliStatus {
  installed: boolean
  version: string | null
  path: string | null
  platform: 'darwin' | 'unsupported'
}

// The two managed runtime dependencies the app delivers and tracks for the
// Draw Things backend: the CLI binary it downloads itself, and the recommended-
// parameters file (configs.json). Both follow the managed-runtime-dependencies
// convention. The CLI has metadata-only checks; versionless configs.json is
// installed or refreshed only by an explicit user action.
export type DependencyId = 'cli' | 'recommendations'

// The four lifecycle states a managed dependency can be in. "installed-unchecked"
// is present-but-never-successfully-compared-to-latest (offline, or the launch
// check is disabled and none has been run) — distinct from a confirmed up-to-date.
export type DependencyState =
  | 'not-installed'
  | 'up-to-date'
  | 'update-available'
  | 'installed-unchecked'

// One dependency's surface state for the modal and the pane pointer. The labels
// are presentation-ready strings derived in main: for the CLI they are release
// tags; for configs.json the installed label summarizes the file (entry count +
// date) and there is no latest label because it is versionless.
export interface DependencyInfo {
  id: DependencyId
  state: DependencyState
  installedLabel: string | null
  latestLabel: string | null
  // When the installed artifact was last written (configs.json's mtime); null for
  // the CLI, whose identity is its tag. ISO-8601 UTC; the renderer formats it.
  updatedAtUtc: string | null
  lastCheckedAtUtc: string | null
}

export interface DependenciesState {
  cli: DependencyInfo
  recommendations: DependencyInfo
  // The launch-time metadata-check toggle for the CLI (default on).
  checkUpdatesAtLaunch: boolean
  // False off macOS, where the Draw Things backend (and so these dependencies)
  // does not exist; the renderer hides the whole surface.
  platformSupported: boolean
}

// Progress for the CLI binary download (the only long-running dependency op).
// Streamed over 'dependencies:progress' while installCli/updateCli runs.
export interface DependencyProgress {
  phase: 'downloading' | 'verifying' | 'installing'
  downloadedBytes: number
  totalBytes: number | null
}

export interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

// Result of attempting to read the Draw Things `custom.json` file in the
// effective models directory. The three states are distinguished so the
// renderer can pick the right fallback: when the file is genuinely absent
// (a fresh install with no imports yet) we trust the CLI's source column;
// when it exists but can't be parsed we trust the CLI for usability but
// surface a warning, since imports there may be misclassified as official.
export type CustomJsonStatus =
  | { kind: 'present'; files: string[] }
  | { kind: 'absent' }
  | { kind: 'unreadable'; category: 'invalid-format' | 'read-failed' }

// Only the fields the dependency surface actually reads. The recommendations
// file (configs.json) is otherwise versionless and is refreshed explicitly.
export interface RecommendationStatus {
  exists: boolean
  valid: boolean
  entryCount: number
  updatedAt: string | null
}

export interface RecommendedParams {
  width: number | null
  height: number | null
  steps: number | null
  guidance: number | null
  negativePrompt: string | null
  matchName: string
  matchModel: string | null
  matchType: 'exact' | 'prefix' | 'prefix-parent' | 'version'
}

export interface DrawThingsModelParams {
  width: number
  height: number
  steps: number
  guidance: number
  seed: string
  negativePrompt: string
}

export type TextAIBackendId = 'gemini' | 'openai'
export type TaskStatus = 'queued' | 'generating' | 'completed' | 'kept' | 'failed' | 'interrupted'
// Two lanes, not three. A `content` lane existed and was removed on measurement:
// swapping between its templates moved the resulting image 2.7/10, and DELETING
// it moved it 2.2 — less than the noise between two of its own variants, on both
// a person seed and a food seed. Its job (what details a subject needs) is now
// the concept mechanism's: occupation, setting, era and object arrive as drawn
// concepts, so a template asking for them was describing what was already there.
export type ElaboratorKind = 'composition' | 'style'

export const ELABORATOR_KIND_LABELS: Record<ElaboratorKind, string> = {
  composition: 'Composition',
  style: 'Style',
}

export interface Elaborator {
  id: string
  kind: ElaboratorKind
  name: string
  description?: string
  template: string
}

export interface Task {
  id: string
  prompt: string
  backend: BackendId
  model: string
  params: Record<string, unknown>
  status: TaskStatus
  enqueuedAt: string
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  imagePath: string | null
  baseName: string | null
  error: string | null
}

export interface EnqueueRequest {
  prompt: string
  backend: BackendId
  model: string
  params: Record<string, unknown>
  count: number
}

export interface EnqueueBatchUnit {
  prompt: string
  backend: BackendId
  model: string
  params: Record<string, unknown>
}

/** One facet's contribution to a prompt: which aspect varied, and the value drawn. */
export interface ConceptCredit {
  facet: string
  concept: string
}

/**
 * One elaborated prompt with the ledger assignment that grounded it. `concepts`
 * is empty for prompts that predate concept credits (older manifests store bare
 * strings, normalized on read) and for anything not produced by a brainstorm.
 */
export interface ElaboratedPromptRecord {
  text: string
  concepts: ConceptCredit[]
}

export const SESSION_MANIFEST_VERSION = 1

export interface SessionTaskCounts {
  total: number
  queued: number
  generating: number
  completed: number
  kept: number
  failed: number
  interrupted: number
}

export interface SessionManifest {
  version: typeof SESSION_MANIFEST_VERSION
  sessionId: string
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
  taskCounts: SessionTaskCounts
  elaboratedPrompts: ElaboratedPromptRecord[]
  // The renderer's working state for this session (prompt + Advanced Prompting
  // selections). Optional on disk: manifests written before this field existed,
  // or with a malformed draft, load fine and are backfilled with an empty draft
  // on read (see normalizeSessionDraft).
  draft: SessionDraft
  tasks: Record<BackendId, Task[]>
}

export interface SessionThumbnail {
  baseName: string
}

// What the queue-control menu enables or disables against. Counts rather than
// booleans so the menu can say how much each action would affect.
/**
 * Which stage of a brainstorm run a progress event describes. A cold run spends
 * most of its time before a single prompt exists — resolving which aspects to
 * vary, then minting concepts — so a counter alone reports nothing for the part
 * of the wait that is longest. Main names the stage; the renderer owns the
 * wording.
 */
export type BrainstormPhase = 'facets' | 'concepts' | 'prompts'

export interface QueueControlState {
  paused: boolean
  generating: number
  queued: number
  interrupted: number
}

// The api keys the app stores, by id. A key id is a dotted path of segments:
// the conventional vendor/env name plus an optional purpose segment, so the
// environment variable derives from it with no mapping table (`gemini.text` →
// GEMINI_TEXT_API_KEY). Shared because the Settings form edits keys by these
// ids over their own IPC — keys are not part of the config payload.
export const SECRET_IDS = [
  'gemini.text',
  'openai.text',
  'openai.image',
  'gemini.nanobanana',
  'xai',
  'bfl',
] as const
export type SecretId = (typeof SECRET_IDS)[number]

// Image backend id (product) → the vendor key id its key is stored under.
// `grok` is xAI's product, `flux` is Black Forest Labs' — the backend keeps its
// product name everywhere; only the API key is the conventional vendor segment.
export const IMAGE_BACKEND_SECRET: Record<CloudBackendId, SecretId> = {
  openai: 'openai.image',
  nanobanana: 'gemini.nanobanana',
  grok: 'xai',
  flux: 'bfl',
}

// Which API keys resolve, environment values included — the presence signal the
// renderer needs because the api-key payload carries only stored keys (so that
// editing a field cannot overwrite an env-supplied key). Booleans only: no key
// value ever crosses this boundary.
export interface ApiKeyPresence {
  image: Record<CloudBackendId, boolean>
  geminiText: boolean
  openaiText: boolean
}

// Concept-ledger rows surfaced to the Concept Library modal. Shapes mirror
// concept-store.ts; shared here so preload and renderer type against one source.
export interface ConceptFacetSummary {
  id: number
  display: string
  conceptCount: number
  unusedCount: number
  probeCount: number
  lastUsedAt: string | null
}

export interface ConceptRow {
  id: number
  probeId: number
  display: string
  probe: string
  useCount: number
  lastUsedAt: string | null
  createdAt: string
}

export interface ConceptProbeSummary {
  id: number
  display: string
  expanded: number
  conceptCount: number
  unusedCount: number
}

export interface SessionSummary {
  sessionId: string
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
  taskCounts: SessionTaskCounts
  completedCount: number
  retryCount: number
  keptCount: number
  thumbnails: SessionThumbnail[]
  isCurrent: boolean
}
