# ImageQueue

ImageQueue is a desktop app for comparing image generation backends side-by-side. Write one prompt, queue it to one backend or all of them, then review, export, and compare the results in one place.

## Backends

| Backend | API key |
|---|---|
| OpenAI GPT Image | Required |
| Google Imagen | Required |
| Nano Banana (Gemini) | Required |
| Grok Imagine | Required |
| FLUX (Black Forest Labs) | Required |
| Draw Things (local CLI, macOS only) | Not required |

## Requirements

- Node.js 20+ (CI builds on the current LTS)
- macOS, Windows, or Linux
- Draw Things support is macOS-only

## Development

```sh
npm install
npm run dev
```

```sh
npm run build
```

```sh
npm run typecheck
```

### Tests

Unit tests (Vitest) cover the pure main-, shared-, and renderer-process logic — cost estimation, image-type detection, the queue state machine, timestamp allocation, config merging, session manifest handling, the brainstorm run lifecycle the wake lock keys off, and renderer-side helpers like enqueue composition and backend readiness. They run in a plain Node environment with no Electron or DOM dependencies. Tests live under `tests/`, mirroring the `src/` layout, so `src/` stays pure shipped code; they are type-checked separately via `tsconfig.test.json`.

The production typecheck is split by runtime environment so cross-environment mistakes are caught statically: `tsconfig.node.json` (main + preload — Node, no DOM) and `tsconfig.web.json` (renderer — DOM, no Node types). A main-process file reaching for a browser global, or a renderer file reaching for a Node global, fails the check. Preload is checked on the Node side (it imports `electron`); the `ElectronAPI` bridge type lives in `src/shared`, so the renderer never imports preload.

```sh
npm test          # run once
npm run test:watch
npm run typecheck  # node + web + tests
```

## Everyday workflow

1. Enter a prompt, or click **Paste Text** to replace it with plain text from the clipboard when available.
2. Choose a backend column, or use **Send to All**.
3. Review queued, running, completed, failed, and interrupted tasks in each column.
4. Select a completed task to preview, inspect metadata, export, reveal, or copy it.

For cloud backends, the queue column remembers the last model and generation settings you used and restores them on the next launch. Draw Things keeps its settings separately per local model.

## Sessions

Each app launch creates a session folder under the output directory. ImageQueue writes a `session.json` snapshot there as queue and draft state change, so you can later reopen that session from the menu.

- **New Session** switches to a fresh empty session without needing another app window.
- **Resume** restores completed outputs as-is and brings unfinished work back as interrupted tasks. When a reopened session still has interrupted tasks, a prompt offers **Resume All** (re-queue every interrupted task for generation at once) or **Not Now** (leave them paused); either way each task keeps its individual **retry**.
- A session is considered **empty** when no tasks remain in any backend, regardless of status. The elaborated-prompts list and the working draft (the prompt and Advanced Prompting selections) do not count — they support work in progress and are discarded with an empty session.
- When **Drop empty sessions** is on (the default), the current session is auto-dropped on New Session, Resume, and graceful quit if it is empty. Auto-drops honor the **Delete to Trash** setting.
- **Delete** removes that session folder according to the **Delete to Trash** setting.
- Resume also restores the session's working draft: the prompt you were composing and the Advanced Prompting selections (seed, elaborator picks, targets, mode, iteration count). Genuinely transient UI state — the current selection and preview, the fullscreen viewer, and the **Show Kept Images** toggle — is not restored.
- Only sessions with a readable `session.json` snapshot appear.
- Each session folder also holds a `session.log`: a per-launch [JSON Lines](https://jsonlines.org) record (one JSON event per line) of what the app did — startup and effective settings, each queued and generated task, external calls, and every warning or error with its full stack. `debug`-level lines are diagnostic-only: on in a development build (`npm run dev`) or with `IMAGEQUEUE_DEBUG=1`, off in packaged builds. Logs follow the session folder lifecycle: auto-dropping or deleting a session removes or trashes its `session.log` with it. Secret-bearing fields (API keys) are redacted; attach the relevant `session.log` when filing an issue.
- Session previews currently read the original output images directly. Cached thumbnail files are intentionally not generated yet; if browsing later becomes measurably slow, add relative thumbnail paths in `session.json` and generate missing thumbs on demand.

## Settings overview

Open Settings with **Cmd+Comma** (macOS) or **Ctrl+Comma** (Windows/Linux).

### General

| Setting | Default | Description |
|---|---|---|
| Auto-preview after idle | 30 s | Auto-selects a newly completed image after this many seconds of inactivity. Set to 0 to disable. |
| Export folder | Desktop | Directory where **Export** saves images. Leave empty to use the Desktop. |
| Confirm before removing | Off | Confirm before removing a task from the queue, or marking a completed image as kept. |
| Confirm before deleting | Off | Confirm before deleting a task and its files. |
| Delete to Trash | On | Send deleted task files and session folders to the system Trash instead of permanently deleting them. |
| Drop empty sessions | On | Auto-delete the current session folder on New Session, Resume, or graceful quit when no tasks remain. Honors **Delete to Trash**. |
| Keep system awake during work | On | Prevent the computer from sleeping while generating images, downloading or importing Draw Things models, or elaborating prompts. The display may still turn off. See [Staying awake during long runs](#staying-awake-during-long-runs). |

### Cloud backends

Each cloud backend has its own section with:

| Setting | Description |
|---|---|
| Model | Which model variant to use |
| Concurrency | How many simultaneous requests ImageQueue may send |
| Timeout | Maximum wait time before failing a task |

Some backends also expose backend-specific generation parameters such as moderation, quality, aspect ratio, image size, custom width/height, steps, guidance, or seed.

OpenAI GPT Image 2 supports both presets and editable width/height values. Imagen, Nano Banana, and Grok use aspect-ratio-driven sizing, and FLUX keeps curated preset size picks. Only FLUX.2 Flex exposes steps and guidance.

### Cost estimates

ImageQueue shows rough pre-run cost estimates for proprietary image backends when a simple model-registry estimate is available. These estimates are intentionally approximate: provider billing can depend on tokens, quality, dimensions, rounding rules, input images, discounts, and provider-side changes. ImageQueue does not parse provider token usage or maintain a full token/parameter billing calculator; that was considered and rejected as too complex to maintain for an alpha comparison tool.

### Draw Things

Draw Things has its own setup and workflow guide in [docs/draw-things-cli.md](docs/draw-things-cli.md).

### Text AI

ImageQueue uses text AI models for short filename slugs and for prompt elaboration in Advanced Prompting. If slug generation fails or times out, ImageQueue falls back to a random ID automatically.

Pick a provider with **Backend**. Each backend keeps its own credentials, models, and timeout; only the selected one is called at runtime.

| Setting | Default | Description |
|---|---|---|
| Backend | Gemini | Which provider to use: Gemini or OpenAI |

#### Gemini

| Setting | Default | Description |
|---|---|---|
| API Key | — | Gemini API key |
| Light model | Gemini 3.1 Flash Lite | Used for short, lightweight tasks like filename slug generation |
| Main model | Gemini 3 Flash (Preview) | Used for general text work, including prompt elaboration in Advanced Prompting |
| Timeout | 30 s | Maximum wait time per request; slug generation falls back to a random ID on timeout |

The built-in Gemini text model list currently offers **Gemini 3.1 Pro (Preview)**, **Gemini 3.5 Flash**, **Gemini 3 Flash (Preview)**, and **Gemini 3.1 Flash Lite**.

#### OpenAI

Works with the official OpenAI endpoint and with any OpenAI-compatible server (OpenRouter, xAI, DeepSeek, local llama-server, etc.).

| Setting | Default | Description |
|---|---|---|
| Endpoint | — | OpenAI-compatible base URL. Leave empty for the official OpenAI endpoint (`https://api.openai.com/v1`) |
| API Key | — | API key for the selected endpoint |
| Light model | — | Free-text model ID used for slug generation |
| Main model | — | Free-text model ID used for prompt elaboration |
| Timeout | 60 s | Maximum wait time per request; slug generation falls back to a random ID on timeout |

The **Prompts → Slug template** setting controls the instruction sent to the text model.

## Notifications

When a generation finishes while ImageQueue is not focused, the app can notify you with:

- a small visual toast near the top-center of the display
- a short success or failure sound

The toast includes the app name so it still makes sense when shown over other apps.

### Quick controls

Three controls sit in the prompt pane next to **Send to All**:

| Control | Description |
|---|---|
| **Notify** | Enable or disable the visual toast |
| **Sound** | Enable or disable audio cues |
| **Volume** | Adjust playback volume |

### Settings → Notifications

The full Notifications settings page provides the same toggles plus custom sound files:

| Setting | Description |
|---|---|
| Success sound | Custom audio file for successful generation |
| Failure sound | Custom audio file for failed generation |

### Platform notes

Notifications and sounds work reliably on macOS and Windows. On Linux, visual notification behavior depends on the desktop environment; sounds work regardless.

## Staying awake during long runs

While image generation is running, a Draw Things model is downloading or importing, or a prompt elaboration is in flight, ImageQueue holds a system power assertion so the machine does not go to sleep and interrupt the work. The assertion is released automatically the moment all such work finishes, so the computer can sleep normally again. The display is still allowed to turn off — only system sleep is prevented.

This is the cross-platform equivalent of macOS `caffeinate`, using the OS's native mechanism on each platform. It is on by default; if you would rather let the machine sleep on its normal schedule, turn off **Settings → General → Keep system awake during work** and save — the change applies within a second, even mid-run. Two limits are inherent to the OS, not the app:

- On macOS, closing the lid on battery with no external power or display still sleeps the machine — no app can override clamshell sleep.
- On Linux, the assertion is honored only by desktop environments that implement the standard inhibit interface.

## Working with completed images

When a completed task is selected, a toolbar appears below the preview:

| Button | Description |
|---|---|
| **Copy Prompt** | Copy the prompt text |
| **Reveal** | Open the file manager and highlight the image |
| **Copy to Clipboard** | Copy the image itself |
| **Export** | Save a copy to the export folder |
| **Save As…** | Pick the destination and filename manually |

Each completed task row also has **exp** for quick export, **keep** to mark the image as kept while removing it from the active list, and **del** to delete the task and its files.

Removing a queued, failed, or interrupted task drops it from the queue. Using **keep** on a completed task leaves that output in session history but removes it from the active list and marks it as kept. This keeps the active queue focused on images that still need review, so already-checked acceptable fallbacks do not stay mixed with fresh or unresolved results. Enable **Show Kept Images** from the hamburger menu to review kept images; shown kept rows can be restored, exported, or deleted. The toggle resets to off on each launch — kept images are typically only useful within the session that produced them.

Below the toolbar, a collapsible details strip shows the model and prompt at a glance. Expand it for full metadata such as status, rough estimated cost, duration, and generation parameters.

## Advanced Prompting

The **Advanced Prompting** button above the prompt textarea opens a modal for batch generation across multiple backends and models, optionally with AI-generated prompt variations.

The modal has three panes:

- **Prompt** — your seed text, three elaborator pickers (**Content**, **Composition**, **Style**), the **Elaborate** button, and the resulting elaborated prompt.
- **Targets** — checkboxes for proprietary backends and (on macOS) downloaded Draw Things models. Long Draw Things model names are truncated; hover the row to see the full name.
- **Execution** — top to bottom: target scope, prompt source, prompt format, prompt length, iteration count, and the **Queue Tasks** button.

Four prompt sources:

| Mode | Behavior |
|---|---|
| **User prompt as-is** | Send the seed verbatim. No AI involvement. |
| **Elaborated prompt (same for all)** | Use the result from clicking **Elaborate**, identical for every queued task. **Elaborate** is a preview — it fills the elaborated box and records the result, but does not switch the prompt source; select this mode yourself to queue that text. |
| **Fresh elaboration per iteration** | Generate one new elaborated prompt per iteration; queue one task per selected target in each round, with all selected models in that round sharing the same prompt. Task creation within a round uses cloud display order and Draw Things alphabetical order. New tasks are inserted at the top of each backend column, while execution still proceeds from the bottom upward. |
| **Fresh elaboration per task** | Generate one new elaborated prompt for every (model × iteration) pair — all unique. Task creation is still round-robin by round, with cloud backends first in display order and Draw Things models after them in alphabetical order. New tasks are inserted at the top of each backend column, while execution still proceeds from the bottom upward. |

**Prompt format** and **prompt length** control the shape of the generated text — *Natural sentences* or *Comma phrases* (tag style), at *Short*, *Medium*, or *Long*. They apply whenever the app generates text: the **Elaborate** preview and both fresh modes. The default is *Natural sentences* / *Medium*, geared to the cloud backends; *Comma phrases* suits Draw Things, and shorter lengths keep prompts distinct as the session's avoid-list grows.

Elaborated prompts accumulate in a per-session list. The text AI sees previously elaborated prompts as context on each new request and avoids repeating them. The list persists across closing and reopening the modal, and is saved in `session.json` so it comes back when you resume that session later. Starting a different session still gives you that other session's own list.

The rest of your Advanced Prompting setup persists the same way: the seed, the three elaborator selections, the chosen targets, the prompt-source mode, the prompt format and length, and the iteration count are saved in `session.json` alongside the main prompt. Resuming a session brings the whole working context back; a new session starts blank.

Click **Elaborated (N)** below the elaborated prompt textarea — or open **☰ → Elaborated Prompts** — to open the manager. The list is numbered and shown newest-first so the latest prompt is immediately visible, while the underlying AI context remains chronological. Per-row **Delete** removes a prompt without confirmation; **Delete All** is gated by a confirm. Deletions affect future brainstorm calls — anything removed from the list is no longer presented to the text AI as something to avoid.

A successful **Queue Tasks** closes the modal — the newly filled queue columns are the confirmation, so there is no success message. To run another round, reopen Advanced Prompting; your whole setup, including the grown avoid-list, is restored. If queueing fails, the modal stays open with the error so you can retry. Clicking outside it does not close it. Prompts are recorded in the elaborated-prompts list only once their tasks are queued (or, for a single **Elaborate**, once the result appears), so a run that is cancelled or fails partway leaves nothing behind. While an elaboration or queue operation is in flight, closing the modal asks for confirmation; confirming stops the in-flight generation and discards that run entirely. While that run is in flight the **Elaborate**, **Queue Tasks**, and **Elaborated (N)** controls are all disabled — only one operation can drive the text AI at a time — and they re-enable the moment it finishes. When nothing is running, you can close the modal with **Esc** or the close button.

## Elaborators

**☰ → Elaborators** opens the elaborator manager. An elaborator is a saved system instruction telling the text AI how to elaborate a seed prompt. Each elaborator belongs to one of three categories:

- **Content** — makes the subject and scene more distinct without breaking intent.
- **Composition** — controls framing, camera distance, arrangement, and visual hierarchy.
- **Style** — controls rendering medium and overall visual finish.

The manager shows these as three side-by-side panes with independent **New**, **Edit**, **Delete**, and **Reset Defaults** controls. Each category keeps its own list.

The shipped defaults are broad, neutral starter sets across all three categories: content defaults for common subject families such as people, groups, animals, places, objects, food, fashion, nature, technology, events, fantasy, and abstract concepts; composition defaults ordered from more scene-building choices to simpler reference-like choices; and style defaults that focus on rendering language rather than content or camera framing.

## Elaboration Settings

**☰ → Elaboration Settings** controls how the text AI is called during elaboration:

| Setting | Description |
|---|---|
| Batch size | Prompts per conversation turn (1–50) |
| Max retries per turn | Extra attempts after a transient failure (0–10) |
| Retry backoff (ms) | Comma-separated delays between attempts |
| Templates | The three message formats sent to the AI; placeholders `{{ELABORATOR}}`, `{{SEED}}`, `{{PREVIOUS}}`, `{{FORMAT}}`, `{{N}}`, and `{{JSON}}` are substituted at call time. The shipped defaults wrap substituted content in explicit XML-like tags so models can see where embedded strings end. `{{JSON}}` is filled by the app and cannot be corrupted by editing the template. `{{FORMAT}}` is filled from **Format directives** below; keep it in every template so the directive is restated on each turn. |
| Format directives | The pieces of the `{{FORMAT}}` instruction: one sentence per format (2) and one per length (3). The chosen format part and length part are joined with a single space at call time. Lengths use approximate word counts, which models obey more consistently than phrase counts. Edit any part to retune. |

Editing the templates lets you, for example, instruct the AI to translate seed prompts from another language to English before elaborating, or to adjust tone and phrasing for the kind of prompts you produce.

## Menu

The hamburger menu (☰) gives access to:

| Item | Description |
|---|---|
| Open Output Folder | Open the directory that stores session outputs |
| Sessions | Browse saved sessions, resume one, or delete one |
| Show Kept Images | Show or hide completed images marked as kept |
| Settings | Open Settings |
| Draw Things Models (macOS) | Open the Draw Things model browser and importer |
| Elaboration ▸ | Hover to reveal the elaboration submenu (see below) |
| Keyboard Shortcuts | Open the shortcut reference |
| About | Show version and links |

The **Elaboration** submenu flies out to the right on hover:

| Submenu item | Description |
|---|---|
| Elaborators | Manage prompt elaborators |
| Elaboration Settings | Tune batch size, retries, and AI message templates |
| Elaborated Prompts | Review and delete prompts elaborated in the current session |

## Keyboard shortcuts

| Action | macOS | Windows/Linux |
|---|---|---|
| Replace prompt with clipboard text | Cmd+P | Ctrl+P |
| Send to all backends | Cmd+Enter | Ctrl+Enter |
| Send to visible backend by column number | Cmd+1 to Cmd+6 | Ctrl+1 to Ctrl+5 |
| Open Settings | Cmd+Comma | Ctrl+Comma |
| Open keyboard shortcuts | Cmd+/ | Ctrl+/ |
| Show / hide kept images | Cmd+Shift+K | Ctrl+Shift+K |
| Move selection within a column (also navigates in fullscreen viewer) | Up / Down | Up / Down |
| Move selection across columns (also navigates in fullscreen viewer) | Left / Right | Left / Right |
| Open fullscreen image viewer | Space | Space |
| Close fullscreen image viewer | Space or Esc | Space or Esc |
| Remove selected task, keep the selected completed image, or restore a selected kept image (also works in fullscreen viewer) | Backspace | Backspace |
| Delete selected task and files (also works in fullscreen viewer) | Delete or Cmd+Backspace | Delete or Ctrl+Backspace |
| Clear selection / close panel | Esc | Esc |

## Draw Things

See [docs/draw-things-cli.md](docs/draw-things-cli.md) for local model management, recommendation behavior, and generation details.

## License

MIT. See [LICENSE](LICENSE).
