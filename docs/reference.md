# imagequeue — Reference

This is the behavioral contract and capability surface for imagequeue: what an integrator or AI agent needs to drive the toolkit without reading the implementation. Code is the source of truth; this document carries only what reading the source won't cheaply give — result/error/exit semantics, on-disk artifacts, concurrency, and the operational caveats that beat reading the code.

## What this toolkit actually is (read first)

imagequeue is an **Electron desktop application** for batch image generation across multiple AI image backends. It is not a published npm SDK and has no standalone argv CLI binary. Its single capability surface is the **`window.electronAPI` IPC contract** — a `contextBridge` API the main process exposes to the renderer. The renderer (the GUI) is the thin binding over that surface, the same way an SDK method or CLI subcommand would be in a library-shaped toolkit. So when this document says "operation," it means one `electronAPI` method, which is a thin wrapper over exactly one `ipcRenderer.invoke(channel, …)` call, handled in the main process. Each operation is named by its `electronAPI` method and its IPC channel — these are the two faces of the one binding, not parallel surfaces.

The interface is defined once as `ElectronAPI` in `src/shared/electron-api.ts`; the preload (`src/preload/index.ts`) implements it with `satisfies ElectronAPI` (so method and channel can never drift), and every main-process handler is registered through one wrapper, `handle(channel, fn)` in `src/main/ipc-boundary.ts`. Shared data types live in `src/shared/types.ts`, `src/shared/cli-jobs.ts`, and `src/shared/session-draft.ts`. The valid model strings, size presets, and pricing tables are a data registry in `src/shared/models.ts` — consult it directly rather than relying on a restatement here.

There is one genuine *external* CLI in play: the **Draw Things CLI** (`draw-things-cli`), which imagequeue drives as a child process for the local `drawthings` backend and for model import/download. Those operations (the `local:*`, `cli-job:*`, `drawthings:*`, `recommendations:*` channels) are documented below as ordinary operations; their "exit codes" are the spawned CLI's process exit codes, surfaced through the job/result shapes, not exit codes of imagequeue itself.

## The IPC boundary contract (applies to every operation)

Every operation is a renderer→main `invoke`: it returns a `Promise` that resolves to the documented value or **rejects** with the thrown error. All handlers are wrapped by `handle()`, which runs the handler inside `async` (unifying synchronous throws and async rejections), and on any throw logs one structured line — `"IPC handler failed"` with `{ channel, error }` where `error` is the full type/message/stack/cause flattened by `serializeError` — and then **rethrows**, so the renderer's promise rejects exactly as the handler threw. The wrapper never swallows: an operation that chooses to ignore a bad input and return early is unlogged at the boundary and resolves normally.

Errors are plain JavaScript `Error` objects (no custom error classes, no stable string codes, no numeric exit codes at the IPC layer). Failure modes are therefore distinguished by message text and by which operations throw versus return a sentinel (`null`, `false`, `[]`, or a `{ success, error? }` result object). Where an operation has both kinds, both are stated. Arguments and return values cross the process boundary by structured clone in both directions, so returned objects are copies — mutating them does not affect main-process state.

There is no cross-process cancellation token. The only cancellable long-running operation is brainstorm (via a separate cancel operation keyed by `requestId`); everything else runs to completion or rejects.

## Data directory and on-disk artifacts

All persistent state lives under `~/.imagequeue/` (literally `os.homedir()/.imagequeue`; there is no env var or config key to relocate it):

- `~/.imagequeue/config.json` — the `AppConfig` (see Configuration). API-key fields are stored obfuscated, not encrypted.
- `~/.imagequeue/elaborators.json` — the elaborator library (pretty JSON; non-atomic write).
- `~/.imagequeue/params.json` — per-model Draw Things parameter overrides (atomic, debounced write).
- `~/.imagequeue/models/` — default Draw Things models directory (overridable via config `image_backends.drawthings.models_dir`).
- `~/.imagequeue/data/configs.json` — downloaded Draw Things recommendation specs.
- `~/.imagequeue/output/<sessionId>/` — one directory per session. Contains `session.json` (the `SessionManifest`, atomic write), `session.log` (JSONL diagnostics), and per generated image a pair `<baseName>.<ext>` + `<baseName>.json` (the image and its `ImageMetadata` sidecar).

A `sessionId` is the directory's basename, formatted `yyyymmdd-hhmmss-utc` in UTC; same-second collisions bump the timestamp by one second so ids are unique. Output base names are `<timestamp>-utc-<slug>-<backend>` for the first image of a given second, with a `-2`, `-3`, … tail appended after the backend token for later images in the same second (see the Sessions section for the allocator's guarantees).

## Environment variables and runtime gating

Only two environment variables affect behavior, both read at startup in `src/main/index.ts`:

- `IMAGEQUEUE_DEBUG=1` — enables debug-level logging in a packaged build (debug is on automatically in an unpackaged dev build).
- `ELECTRON_RENDERER_URL` — dev-server URL; its presence also relaxes the renderer Content-Security-Policy to dev mode.

No API keys or config values are read from the environment. Child processes spawned for Draw Things import inherit the full `process.env`.

The Draw Things integration is documented in the source as macOS-only, but only `local:checkCli` actually gates on platform (returning `platform: 'unsupported'` off macOS without spawning). Every other `local:*`, `cli-job:*`, and the `drawthings` image backend will attempt to spawn `draw-things-cli` on any platform and fail through their normal error paths if it is absent. Treat `local:checkCli` as the gate; do not assume the rest short-circuit off macOS.

---

# Queue operations

The queue is an in-memory, per-backend store of `Task` objects (`queueManager`, `src/main/queue/queue-manager.ts`), persisted into the active session's `session.json` on every mutation. Backends are the six `BackendId` values: `'openai' | 'imagen' | 'nanobanana' | 'grok' | 'flux' | 'drawthings'`. A `Task` (full shape in `src/shared/types.ts`) carries `id`, `prompt`, `backend`, `model`, `params`, `status`, `estimatedCostUsd` (number | null), timing fields, `imagePath`, `baseName`, and `error`. `TaskStatus` is `'queued' | 'generating' | 'completed' | 'kept' | 'failed' | 'interrupted'`.

**Caveat — no validation at the queue boundary.** None of the queue operations validate `backend` against the `BackendId` set; an unknown backend string throws a `TypeError` (reading an undefined queue array) that rejects the promise. `count`, `model`, `prompt`, and `params` are likewise unvalidated. The `[1, 9999]` count clamp (`normalizeCount`) exists only on the session-draft side and is **not** applied to `EnqueueRequest.count` — a count ≤ 0 silently produces zero tasks.

### enqueue — `electronAPI.enqueue` / channel `queue:enqueue`

Creates `count` identical tasks (same prompt/backend/model/params, distinct `id` and `enqueuedAt`) at the front of the backend's queue, each `status: 'queued'`. `estimatedCostUsd` is computed once now via the model registry (`null` if the model is unknown or for drawthings, which is free) and never recomputed. Argument: `EnqueueRequest = { prompt, backend, model, params, count }`. Returns the created `Task[]`. Side effects: persists the session, broadcasts `queue:updated`.

### enqueueBatch — `electronAPI.enqueueBatch` / channel `queue:enqueueBatch`

Like enqueue but one task per unit, allowing heterogeneous backend/model/params in a single call. Argument: `EnqueueBatchUnit[]` (each `{ prompt, backend, model, params }`, no `count`). Returns `Task[]` in input order. Same persistence and broadcast.

### getTasks — `electronAPI.getTasks` / channel `queue:getTasks`

Returns the **active** tasks (`status !== 'kept'`) for one backend. Argument: `backend`. Returns `Task[]`.

### getAllTasks — `electronAPI.getAllTasks` / channel `queue:getAllTasks`

Returns active (non-kept) tasks for every backend as `Record<BackendId, Task[]>` (all six keys present, empty arrays when none).

### getAllStoredTasks — `electronAPI.getAllStoredTasks` / channel `queue:getAllStoredTasks`

Returns **all** tasks including `kept`, cloned, as `Record<BackendId, Task[]>`. This is exactly the payload pushed in every `queue:updated` event.

### removeTask — `electronAPI.removeTask` / channel `queue:removeTask`

Context-sensitive "remove." Arguments: `backend`, `taskId`. Returns `void`. Behavior by current status: a **`generating`** task is refused (logs a warning, no change); a **`completed`** task is converted to `kept` (hidden, not deleted); other statuses are spliced out of the queue. A missing task is a silent no-op. No files are touched here. Persists and broadcasts only on a real change.

### restoreTask — `electronAPI.restoreTask` / channel `queue:restoreTask`

Flips a `kept` task back to `completed`. Arguments: `backend`, `taskId`. Returns `void`. No-op for any other status or a missing task.

### deleteWithFiles — `electronAPI.deleteWithFiles` / channel `queue:deleteWithFiles`

Removes a task **and** its on-disk image + JSON sidecar (to OS trash when config `general.delete_to_trash` is set, else permanent unlink). Arguments: `backend`, `taskId`. Returns `Promise<void>`. **Caveat:** several early-return paths leave the queue entry in place even though deletion was intended — when the task has no `baseName`, when the extension can't be derived from `imagePath`, or when the file operation throws (each logs a warning/error and returns). In those cases queue and disk can diverge; only a successful file removal also removes the queue entry.

### retryTask — `electronAPI.retryTask` / channel `queue:retryTask`

Re-queues a single `failed` or `interrupted` task, resetting `status` to `queued` and clearing `error`/`startedAt`/`completedAt`/`durationMs`. Arguments: `backend`, `taskId`. Returns `void`. No-op for any other status. **Caveat:** it does *not* clear `imagePath`/`baseName`, so a retried task can carry stale values until it completes again.

### resumeInterruptedTasks — `electronAPI.resumeInterruptedTasks` / channel `queue:resumeInterrupted`

Re-queues every `interrupted` task across all backends. No arguments. Returns the count re-queued (`number`). When the count is zero it persists/broadcasts nothing.

### reorderTasks — `electronAPI.reorderTasks` / channel `queue:reorderTasks`

Reorders the active tasks of one backend to match the given id order; ids not present are dropped, active tasks not named are appended after, and all `kept` tasks are swept to the end. Arguments: `backend`, `taskIds: string[]`. Returns `void`. Always persists and broadcasts.

## The generation processor (how queued work becomes images)

The queue manager is a passive store; a separate loop advances it (`src/main/backends/processor.ts`). `startProcessor()` runs a `setInterval` every **500 ms**. Each tick, for every backend, it dispatches queued tasks up to a per-backend concurrency cap: **drawthings is hard-capped at 1**; every cloud backend uses its config `concurrency` (default 3). Backends run in parallel; within a backend up to `concurrency` tasks are in flight. On dispatch a task goes `queued → generating` (sets `startedAt`, persists, broadcasts). On success it becomes `completed` with `baseName`, `imagePath`, and `durationMs` set, and its image + metadata sidecar are written to the session directory. On any failure — including a disk-write failure *after* a billed cloud generation, which is logged distinctly as the more costly event — the task becomes `failed` with `error` set to a short message (the full error goes to the log). There is **no automatic retry** in this loop. The slug in the output filename is produced by a text-AI call (`generateSlug`, light tier) that falls back to a random `nanoid` and never throws.

---

# Session operations

A session bundles one launch's queue, its draft (the renderer's working prompt state), its accumulated elaborated prompts, and its output files. State lives in `src/main/session/`. Most session mutations persist `session.json` immediately and atomically; the one exception is draft saves, which are debounced (300 ms, coalesced) and flushed on quit or session switch.

### createSession — `electronAPI.createSession` / channel `session:create`

Starts a fresh session: clears the queue, resets the output-timestamp allocators, opens a new session directory and log, adopts an empty draft, persists, and broadcasts `queue:updated` + `session:changed`. No arguments. Returns `Promise<void>`. **Throws** `"Wait for active generation to finish before starting a new session."` if any task is currently `generating`. If config `general.drop_empty_sessions` is set and the outgoing session has no tasks, the outgoing session is dropped (to trash or deleted) — note that elaborated prompts and draft text do **not** count as "user value"; only tasks do.

### listSessions — `electronAPI.listSessions` / channel `session:list`

Returns `SessionSummary[]` sorted newest-first by `updatedAt` then `createdAt`. Each summary carries task counts, `completedCount`, `retryCount` (failed + interrupted), `keptCount`, up to 3 thumbnail base names, and `isCurrent`. Directories without a readable, valid `session.json` are skipped. No arguments.

### resumeSession — `electronAPI.resumeSession` / channel `session:resume`

Switches to an existing session. Argument: `sessionId`. Returns `Promise<void>`. Switching to the already-current session is a silent no-op. **Throws** `"Wait for active generation to finish before resuming another session."` if a task is `generating`; `"Invalid session id."` if the id fails the path-traversal guard (`path.basename(id) !== id`); `"That session is missing a readable session.json file."` if the manifest is absent or invalid. On resume, every task that is not `completed`/`kept` is forced to `interrupted` (clearing per-attempt fields), the allocators are seeded from existing outputs so new files don't collide, and `lastResumedAt` is stamped. Broadcasts `queue:updated` + `session:changed`, and — if any task ended up `interrupted` — `session:interruptedTasks` with `{ count }`.

### deleteSession — `electronAPI.deleteSession` / channel `session:delete`

Deletes a session directory (to trash when `general.delete_to_trash`, else recursive remove). Argument: `sessionId`. Returns `Promise<void>`. **Throws** `"The current session cannot be deleted while it is open."`, `"Invalid session id."`, or `"That session folder no longer exists."` as applicable. No broadcast (the caller re-lists).

### openSessionFolder — `electronAPI.openSessionFolder` / channel `session:openFolder`

Opens the session directory in the OS file manager. Argument: `sessionId`. Returns `Promise<void>`. May throw `"Invalid session id."`; a missing folder is tolerated by the OS open call.

### getSessionDraft / saveSessionDraft — channels `session:getDraft` / `session:saveDraft`

The draft is the renderer's per-session working state (`SessionDraft`, `src/shared/session-draft.ts`): the prompt text plus the Advanced Prompting selections (seed, elaborated text, three elaborator ids, target backends, prompt mode, target scope, count, format, length). `getSessionDraft` returns a normalized `SessionDraft` (empty-draft defaults when none exists; never throws). `saveSessionDraft(draft)` returns `void`; the incoming draft is run through `normalizeSessionDraft` (malformed fields fall back to defaults; `count` clamped to a whole number in `[1, 9999]`; enums validated), so it never throws on bad input, and the write is debounced.

### Elaborated-prompt list — channels `session:getElaboratedPrompts`, `session:appendElaboratedPrompts`, `session:deleteElaboratedPromptAt`, `session:clearElaboratedPrompts`

A per-session list of accepted prompt strings (this is where brainstorm output is persisted — the brainstorm operation itself does not persist). All four return the resulting `string[]`. `getSessionElaboratedPrompts` takes no argument. `appendSessionElaboratedPrompts(prompts: string[])` appends (empty input is a no-op, no persist). `deleteSessionElaboratedPromptAt(index: number)` removes one entry (out-of-range index is a no-op). `clearSessionElaboratedPrompts()` empties the list. Append/delete/clear persist `session.json` immediately.

## The interrupted lifecycle

A task becomes `interrupted` when a session is resumed (any unfinished task is demoted to a single resumable state) or when the app quits with a task still `generating` (so the manifest is never frozen mid-flight — a cloud call already issued cannot be reclaimed). An `interrupted` task is cleared back to `queued` by `retryTask` (one) or `resumeInterruptedTasks` (all).

---

# Prompt elaboration: elaborators and brainstorm

Elaborators are reusable instruction templates in three kinds — `content`, `composition`, `style` — combined to steer a text-AI model that brainstorms image prompts. The library is `~/.imagequeue/elaborators.json`; brainstorm calls the configured text-AI provider (`src/main/text-ai/`).

### Elaborator CRUD — channels `elaborators:list`, `elaborators:create`, `elaborators:update`, `elaborators:delete`, `elaborators:reset`

An `Elaborator` is `{ id, kind, name, description?, template }` (`src/shared/types.ts`).

- **list** (`listElaborators`) — no arguments, returns `Elaborator[]`. On a fresh install or a malformed/unreadable file it silently reseeds and **writes** the shipped defaults (an unreadable file is reseeded wholesale, not repaired per-entry).
- **create** (`createElaborator`) — argument `{ kind, name, description?, template }`; returns the created `Elaborator` with a generated `id` of the form `elab-<nanoid>`. `name` defaults to `'Untitled'` if blank; `description` becomes `undefined` if blank. No validation of `kind` or template content. New items are inserted at the top of their kind's group.
- **update** (`updateElaborator`) — arguments `id`, `patch: { name?, description?, template? }`; returns the updated `Elaborator` or **`null`** if the id is not found (not-found is not an error). `id` and `kind` are not patchable; an omitted field is unchanged; a blank `name` patch keeps the current name; a blank `template` patch is accepted.
- **delete** (`deleteElaborator`) — argument `id`; returns `boolean` (`false` if not found). Any elaborator, including a shipped default, can be deleted.
- **reset** (`resetElaborators`) — optional argument `kind`; returns the full `Elaborator[]` after reset. With a kind, it drops that kind (including user-created ones of that kind) and restores that kind's shipped defaults; without a kind, it replaces the entire library with all shipped defaults (discarding user-created elaborators).

### brainstorm — `electronAPI.brainstormPrompts` / channel `elaborators:brainstorm`

Generates `count` image prompts by calling the configured text-AI **main** provider, applying the three named elaborators plus a seed and format/length directives. Argument:

```
{
  requestId: string,            // caller-chosen id; ties progress + cancellation to this call
  contentElaboratorId: string,
  compositionElaboratorId: string,
  styleElaboratorId: string,
  seed: string,                 // the user's base prompt/idea
  count: number,
  previousPrompts: string[],    // prompts to avoid repeating
  format: 'phrases' | 'sentences',
  length: 'short' | 'medium' | 'long'
}
```

Returns `{ prompts: string[] }`. Generation is multi-turn: each turn asks for up to `batch_size` (config, default 10) prompts and loops until `count` is collected; the model's JSON response is tolerantly parsed and repaired (fenced/prose-wrapped JSON is recovered), and a turn that yields nothing is retried up to `max_retries_per_turn` (default 3) with backoff (`retry_backoff_ms`, default `[1000, 2000, 4000]`). The response shape is forced to `{ "prompts": [...] }` regardless of template edits.

**Failure modes (all `Error`, reject the promise):** `"Count must be at least 1."`; `"Seed prompt is empty."`; `"Content elaborator not found."` / `"Composition elaborator not found."` / `"Style elaborator not found."` (also fires when an id of the wrong kind is passed); `"Text AI is not configured."` (no provider/API key). After retries are exhausted a turn's last provider error propagates. This operation does **not** persist its output — the caller is expected to store accepted prompts via `appendSessionElaboratedPrompts`.

**Progress:** `electronAPI.onBrainstormProgress(requestId, cb)` subscribes to `brainstorm:progress`, delivering `{ done, total }` after each successful turn (counts only, not the prompts), filtered to the matching `requestId`. It returns an unsubscribe function.

### cancelBrainstorm — `electronAPI.cancelBrainstorm` / channel `elaborators:brainstormCancel`

Aborts the in-flight brainstorm for `requestId` (a missing id is a harmless no-op). Returns `void`. **Cancellation is not an error:** the in-flight provider request is aborted (stops spending tokens immediately) and the brainstorm call **resolves** with whatever was collected so far — possibly `{ prompts: [] }` if cancelled before the first turn finished. Integrators should treat an empty-prompts success as a possible cancel outcome, not necessarily a failure.

### Defaults helpers — channels `brainstorm:getDefaults`, `prompts:getDefaultSlug`

`brainstormGetDefaults()` returns the **shipped default** `BrainstormConfig` (`batch_size`, `max_retries_per_turn`, `retry_backoff_ms`, the three message templates, and the format/length `format_directives`) — constructed fresh from defaults, *not* the user's saved config, so the "Reset to defaults" UI stays honest. `promptsGetDefaultSlug()` returns the default slug-generation prompt template string. Neither takes arguments, writes, or throws.

### appLog — `electronAPI.appLog` / channel `app:log`

Lets the renderer append a structured line to the active session's `session.log`. Arguments: `level` (`'info' | 'warn' | 'error' | 'debug'` — an unknown level is silently coerced to `'info'`), `message`, optional `data`. Returns `void`. The logger never throws: a non-serializable `data` degrades to a bare envelope, a write failure degrades to `console.error`, `debug` lines drop unless debug logging is on, and lines logged before a session log path exists are dropped. Secret-named keys in `data` are redacted before write.

## Text-AI providers (the engine behind brainstorm and slugs)

Two providers are supported, selected by config `text_ai.backend`: `gemini` (`@google/genai`) and `openai` (the `openai` SDK, also usable against OpenAI-compatible endpoints). Two tiers exist: **light** (filename-slug generation) and **main** (brainstorm). The provider is `null` — surfacing as `"Text AI is not configured."` — when the selected backend's API key is empty. Defaults: gemini light `gemini-3.1-flash-lite`, main `gemini-3-flash-preview`, timeout 30 s; openai endpoint empty (resolves to `https://api.openai.com/v1`), models empty, timeout 60 s. The Gemini path sends the JSON schema to the server; the OpenAI path uses broadly-compatible `json_object` mode and does not enforce a server-side schema. JSON extraction is tolerant (direct parse → fenced-block strip → balanced-substring scan), returning `undefined` rather than throwing on unparseable text (which becomes a retry upstream).

---

# Preview, export, and shell operations

These read session output and bridge to OS file/clipboard/dialog facilities. Renderer-supplied base names are guarded by `assertSafeBaseName` (rejecting empty, separators, `..`, NUL, or any non-basename) and extensions by `assertImageExt` (only `png`/`jpg`/`webp`); a violation throws and rejects the promise.

### getImage / getSessionImage — channels `preview:getImage` / `preview:getSessionImage`

Reads a generated image from the current session (`getImage(baseName)`) or a named session (`getSessionImage(sessionId, baseName)`), trying `.png`, `.jpg`, `.webp` in that order. Returns `{ data, ext }` or `null` if absent. **Caveat:** `data` is **raw base64** (`Buffer.toString('base64')`), *not* a data URL — the caller must prefix `data:image/<ext>;base64,`.

### getMetadata — channel `preview:getMetadata`

Reads the `<baseName>.json` sidecar from the current session. Argument `baseName`. Returns the parsed object (`ImageMetadata`-shaped) or `null` if absent; malformed JSON throws.

### File/clipboard/dialog operations (all in `src/main/settings-ipc.ts`)

- `openFileDialog(filters)` / channel `dialog:openFile` — returns the first chosen file path or `null`.
- `openDirectoryDialog()` / channel `dialog:openDirectory` — returns a directory path or `null`.
- `openExternal(url)` / channel `shell:openExternal` — opens an http/https URL; non-http(s) or malformed URLs are silently ignored. Returns `void`.
- `openOutputFolder()` / channel `shell:openOutputFolder` — opens `~/.imagequeue/output` (creating it). Returns `void`.
- `revealFile(baseName, ext)` / channel `shell:revealFile` — reveals the file in the OS file manager. Returns `void`.
- `exportImage(baseName, ext)` / channel `shell:exportImage` — copies the image into config `general.export_dir` (or the Desktop), de-duplicating with `-2`, `-3`, … on name collision. Returns the destination path (`string`).
- `exportImageAs(baseName, ext)` / channel `shell:exportImageAs` — same via a Save dialog; returns the chosen path or `null` if cancelled.
- `readClipboardText()` / `hasClipboardText()` — channels `clipboard:readText` / `clipboard:hasText`. Return the clipboard text (`string`) and whether it is non-empty (`boolean`).
- `copyImageToClipboard(baseName, ext)` / channel `clipboard:copyImage` — copies the image to the clipboard. Returns `void`.

### Viewer — `electronAPI.openViewer` / `closeViewer` / `viewerNavigate` / `viewerAction` (+ listeners)

The viewer is a fullscreen kiosk window showing one image. `openViewer(dataUrl)` displays it (awaits decode; rapid re-opens discard stale frames). `closeViewer()` hides it. `viewerNavigate('up'|'down'|'left'|'right')` and `viewerAction('remove'|'delete')` forward intents to the main window, which re-emits them to the renderer via `onViewerNavigate` / `onViewerAction`; `onViewerStateChanged(open)` reports open/closed. The viewer's own keyboard handling maps arrows to navigate, Backspace/Delete (and Cmd/Ctrl+Backspace) to actions, and Escape/Space to close. All four operations return `void`/`Promise<void>`.

### Notifications — `electronAPI.showNotification` / `loadAudioFile`

`showNotification('success' | 'failure')` (channel `notification:show`) displays a frameless in-app toast (centered near the top, auto-hiding after ~3 s) — **not** an OS notification — and makes **no sound**. Returns `void`; render failures are logged, never thrown. Sound is the renderer's responsibility: `loadAudioFile(filePath)` (channel `notification:loadAudioFile`) returns the audio file as a full data URL (`data:<mime>;base64,…`) or `null` if the path is empty/missing, which the renderer plays honoring config `notifications.volume` / `sounds_enabled` / `success_file` / `failure_file`.

---

# Configuration and settings operations

The `AppConfig` (`src/main/config/types.ts`) has six top-level sections: `text_ai`, `general`, `notifications`, `image_backends` (one entry per backend), `prompts`, and `brainstorm`. It is loaded once and cached; a missing file is created from defaults, but a **syntactically invalid `config.json` throws** (`"Config file is not valid JSON: <path>"`) rather than falling back to defaults, so a recoverable file is never clobbered.

**API-key storage caveat:** keys are stored *obfuscated, not encrypted* — base64 of the reversed string, explicitly "not a security measure" (only anti-grep). Anyone with read access to `~/.imagequeue/config.json` can recover them. Each cloud backend decodes its key at call time and throws `"<Backend> API key not configured"` if empty. The startup log redacts keys to presence booleans.

### getSettings — `electronAPI.getSettings` / channel `settings:get`

Returns a deep clone of `AppConfig` with all API keys **decoded** to plaintext (the in-memory cache keeps them encoded). No arguments. Throws only if the config file is invalid JSON.

### saveChangedSettings — `electronAPI.saveChangedSettings` / channel `settings:saveChangedFields`

Applies a recursive `base → next` diff: only changed leaves are written into the live config, so two concurrent editors of different fields don't clobber each other. Arguments: `base`, `next` (both full `AppConfig`-shaped objects). Returns `{ success: true }` on success (there is no `false` path — failures throw). **Throws** `"Settings changes must be an object"` for a non-object `next`, or `"Cannot save unsupported settings section: <key>"` if a changed root key is outside `{ text_ai, general, image_backends, notifications, prompts }` (note `brainstorm` is excluded here — it has its own operation). Changed API-key leaves are re-encoded before write. Persists `config.json`.

### saveBrainstormSettings — `electronAPI.saveBrainstormSettings` / channel `settings:saveBrainstorm`

Wholesale-replaces `config.brainstorm` (no validation). Argument: the brainstorm config object. Returns `{ success: true }`.

### saveImageBackendDefaults — `electronAPI.saveImageBackendDefaults` / channel `settings:saveImageBackendDefaults`

Sets a cloud backend's `model` and shallow-merges `params` into its `default_params`. Arguments: `backend` (a `CloudBackendId` — drawthings cannot be targeted), `model`, `params`. **Throws** `"Cannot save image backend defaults for unsupported backend: <backend>"` for an unknown backend. Returns `{ success: true }`. The merge is shallow — nested param objects are replaced wholesale.

### saveNotificationField — `electronAPI.saveNotificationField` / channel `settings:saveNotificationField`

Writes a single notifications field. Arguments: `field` (one of `notifications_enabled`, `sounds_enabled`, `volume`, `success_file`, `failure_file`), `value` (no type check). **Throws** `"Cannot save unsupported notification setting: <field>"` otherwise. Returns `{ success: true }`.

### checkLocalModel — `electronAPI.checkLocalModel` / channel `settings:checkLocalModel`

Returns `true` if a Draw Things model file exists in the resolved models directory. Argument: `filename`. **Caveat:** unlike the preview/shell operations, this one does *not* guard `filename` against path traversal — the renderer is trusted here.

---

# Draw Things: local CLI, model management, and jobs (macOS)

These operations drive the external `draw-things-cli`. The binary is `config.image_backends.drawthings.cli_path` or the bare string `'draw-things-cli'` (resolved via the inherited `PATH`; there is no `which` resolution and no env override). The models directory is config `image_backends.drawthings.models_dir` (with leading `~` expanded) or `~/.imagequeue/models`.

### checkCli — `electronAPI.localCheckCli` / channel `local:checkCli`

Detects the CLI. Returns `CliStatus = { installed, version, path, platform }`. Off macOS it returns `{ installed: false, …, platform: 'unsupported' }` without spawning. On macOS it runs `--version` (5 s timeout); failure (including timeout) returns `{ installed: false, …, platform: 'darwin' }`. Never throws. `path` echoes the configured string, not a resolved absolute path.

### Model listing and inspection

- `localListDownloadedModels()` / channel `local:listDownloadedModels` — runs `models list --downloaded-only`; returns `LocalModelInfo[]`; swallows CLI errors to `[]`. Creates the models dir as a side effect.
- `localListAvailableModels()` / channel `local:listAvailableModels` — runs `models list`; returns `LocalModelInfo[]`; swallows errors to `[]`.
- `localReadCustomJsonImportedFiles()` / channel `local:readCustomJsonImportedFiles` — reads Draw Things' `custom.json` (ground truth for imported models). Returns `CustomJsonStatus`: `{ kind: 'present', files }` / `{ kind: 'absent' }` / `{ kind: 'unreadable', reason }`. Never throws.
- `localGetModelsDir()` / `local:getModelsDir`, `localGetDefaultModelsDir()` / `local:getDefaultModelsDir` — return the resolved and default models-dir paths (`string`). `localOpenModelsDir()` / `local:openModelsDir` opens it in the file manager (`void`).

### ensureModel — `electronAPI.localEnsureModel` / channel `local:ensureModel`

Downloads/ensures a model (non-streaming). Argument: `modelFile`. Runs `models ensure --model <file>` to completion (no timeout) and returns `EnsureModelResult = { success: boolean; error? }` — failures are returned in `error` (the CLI's stderr or `exit code N`), **never thrown**. For a streamed, observable, killable download use the `cli-job:startDownload` job instead (same CLI command).

### CLI jobs (streamed import/download)

For long-running import/download with live output, kill support, and stall detection, use the **job** operations. Constants (`src/shared/cli-jobs.ts`): ring buffer cap 2000 lines, stall threshold 60 s, kill grace 3 s, retention after exit 10 min (30 s when no subscribers remain).

- `cliStartImport(artifactPath)` / channel `cli-job:startImport` — imports an artifact; returns a `jobId` (`string`). **Import jobs are PTY-spawned (node-pty) and serialized through a single FIFO** — at most one import runs at a time; they require a real TTY.
- `cliStartDownload(modelFile)` / channel `cli-job:startDownload` — downloads a model; returns a `jobId`. **Download jobs are plain-pipe spawned, start immediately, and run concurrently** with each other and with an import.
- `cliSubscribeJob(jobId)` / `cli-job:subscribe` — subscribes the caller and returns a `CliJobSnapshot | null` (full ring buffer) — `null` if the job is unknown/expired.
- `cliUnsubscribeJob(jobId)` / `cli-job:unsubscribe`, `cliKillJob(jobId)` / `cli-job:kill`, `cliGetJobSnapshot(jobId)` / `cli-job:getSnapshot` — unsubscribe, terminate (SIGTERM then SIGKILL after the grace period), and snapshot (`CliJobSnapshot | null`). Killing/snapshotting an unknown job is a no-op/`null`.

A `CliJobSnapshot` carries `jobId`, `kind` (`'import' | 'download'`), `target`, `startedAtMs`, `status` (`'queued' | 'running' | 'stalled' | 'exited' | 'killed'`), `exitCode` (the spawned CLI's process exit code, `null` until terminal or when a spawn error preempts exit), `stalled`, and the `chunks` ring buffer. Live updates arrive via two push events, subscribed through `electronAPI.onCliJobChunk(cb)` (`cli-job:chunk`, payload `{ jobId, chunk, replace? }` — `replace: true` is in-place CR coalescing for progress bars) and `electronAPI.onCliJobStatus(cb)` (`cli-job:status`, payload `{ jobId, status, exitCode, stalled }`). These job channels are not platform-gated; a missing binary surfaces as a `[spawn error]` stderr chunk plus an `exited` status with `exitCode: null`. Only download jobs have stall detection; import jobs do not.

### Recommendations (Draw Things default parameters)

A downloadable set of recommended per-model parameters, stored at `~/.imagequeue/data/configs.json`.

- `getRecommendationsStatus()` / channel `recommendations:getStatus` — returns `RecommendationStatus` (`path`, `directory`, `exists`, `valid`, `entryCount`, `fileSize`, `updatedAt`, `error`).
- `downloadRecommendations()` / channel `recommendations:downloadLatest` — fetches from a fixed https URL (10 s timeout, ≤5 redirects, ≤16 MiB), writing atomically only if the bytes changed. Returns `RecommendationOperationResult` (status + `{ changed, message }`). **Throws** on non-https/invalid URL, too many redirects, non-2xx HTTP, timeout, oversize, or content that parses to zero specs. This download also runs automatically at launch when `image_backends.drawthings.auto_update_recommendations` is set (default true), swallowing errors.
- `importRecommendations(filePath)` / channel `recommendations:import` — imports a local file the same way; throws if unreadable or invalid.
- `resolveRecommendation(modelFile)` / channel `recommendations:resolve` — returns `RecommendedParams | null` for a model. Matching tries, in order, exact model id, quantization-insensitive prefix, prefix-parent, then a coarse version/family; the returned `matchType` records which rule fired. `guidance` is read from the spec's `guidanceScale`; missing numeric fields come back as `null`.

### Per-model parameter overrides

User-saved Draw Things parameters per model file, stored at `~/.imagequeue/params.json` (atomic, debounced 200 ms write).

- `dtGetModelParams(modelFile)` / channel `drawthings:getModelParams` — returns `DrawThingsModelParams | null`. `dtGetAllModelParams()` / `drawthings:getAllModelParams` — returns `Record<string, DrawThingsModelParams>`. Both never throw (a corrupt file degrades reads to empty).
- `dtSaveModelParams(modelFile, params)` / channel `drawthings:setModelParams` — stores one model's params (`void`).
- `dtApplyParamsToAllModels(modelFiles, patch)` / channel `drawthings:applyParamsToAll` — applies a dimension patch (`width`, `height`, `steps`, `guidance` only) across many models (`void`). **Caveat:** despite the name it patches only those four fields; it cannot set `seed`/`negativePrompt` on existing entries.

**Persistence caveat:** if `params.json` is corrupt, reads silently degrade to an empty store but **writes hard-fail** for the rest of the process lifetime — `dtSaveModelParams` and `dtApplyParamsToAllModels` throw a "params.json is unreadable… restart ImageQueue" message until the file is repaired and the app restarted. This latch never overwrites the corrupt file.

---

# Push events (main → renderer)

Beyond per-operation listeners already noted (`onBrainstormProgress`, `onCliJobChunk`, `onCliJobStatus`, viewer listeners), the queue/session lifecycle pushes three events, each subscribed via an `electronAPI.on…` method returning an unsubscribe function:

- `onQueueUpdated(cb)` — `queue:updated`, payload `Record<BackendId, Task[]>` (all tasks including kept). Fired on every queue mutation, every processor dispatch/settle, and session create/resume.
- `onSessionChanged(cb)` — `session:changed`, payload `{ sessionId }`. Fired on create and resume; the renderer re-hydrates session-scoped state.
- `onInterruptedTasksOnResume(cb)` — `session:interruptedTasks`, payload `{ count }`. Fired only on resume when the resumed queue contains interrupted tasks, prompting a re-queue.

---

# Shutdown and process exit

imagequeue terminates through a single graceful-shutdown path on `before-quit`: it flushes debounced writes (draft, model params), marks any still-`generating` task as `interrupted` and persists, closes the viewer/notification windows, kills all CLI jobs, releases the wake lock, drops the current session if it is empty and dropping is enabled, then calls `app.exit(0)`. An uncaught exception flushes the debounced writers best-effort and exits with code `1`; an unhandled rejection is logged but does not exit. An in-flight cloud generation is **not** awaited on quit — it is abandoned and recorded as `interrupted` for resume, since a cloud call already issued cannot be reclaimed. These are the process exit codes of imagequeue itself (`0` normal, `1` crash); they are distinct from the per-job `exitCode` of any spawned `draw-things-cli`.
