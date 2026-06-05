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

Unit tests (Vitest) cover the pure main-, shared-, and renderer-process logic —
cost estimation, image-type detection, the queue state machine, timestamp
allocation, config merging, session manifest handling, and renderer-side helpers
like enqueue composition and backend readiness. They run in a plain Node
environment with no Electron or DOM dependencies. Tests live under
`tests/`, mirroring the `src/` layout, so `src/` stays pure shipped code; they
are type-checked separately via `tsconfig.test.json`.

```sh
npm test          # run once
npm run test:watch
npm run typecheck  # includes the tests
```

## Everyday workflow

1. Enter a prompt, or click **Paste Text** to replace it with plain text from the clipboard when available.
2. Choose a backend column, or use **Send to All**.
3. Review queued, running, completed, failed, and interrupted tasks in each column.
4. Select a completed task to preview, inspect metadata, export, reveal, or copy it.

For cloud backends, the queue column remembers the last model and generation settings you used and restores them on the next launch. Draw Things keeps its settings separately per local model.

## Sessions

Each app launch creates a session folder under the output directory. ImageQueue writes a `session.json` snapshot there as queue state changes, so you can later reopen that session from the menu.

- **New Session** switches to a fresh empty session without needing another app window.
- **Resume** restores completed outputs as-is and brings unfinished work back as interrupted tasks. When a reopened session still has interrupted tasks, a prompt offers **Resume All** (re-queue every interrupted task for generation at once) or **Not Now** (leave them paused); either way each task keeps its individual **retry**.
- A session is considered **empty** when no tasks remain in any backend, regardless of status. Elaborated prompts do not count — they exist only to steer future elaborations and are discarded with the session.
- When **Drop empty sessions** is on (the default), the current session is auto-dropped on New Session, Resume, and graceful quit if it is empty. Auto-drops honor the **Delete to Trash** setting.
- **Delete** removes that session folder according to the **Delete to Trash** setting.
- Current-session resume is intentionally minimal: it restores task history and outputs, not transient UI state such as the current prompt or selection.
- Only sessions with a readable `session.json` snapshot appear.
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
- **Execution** — the prompt source, target scope, iteration count, and the **Queue Tasks** button.

Four prompt sources:

| Mode | Behavior |
|---|---|
| **User prompt as-is** | Send the seed verbatim. No AI involvement. |
| **Elaborated prompt (same for all)** | Use the result from clicking **Elaborate**, identical for every queued task. |
| **Fresh elaboration per iteration** | Generate one new elaborated prompt per iteration; queue one task per selected target in each round, with all selected models in that round sharing the same prompt. Task creation within a round uses cloud display order and Draw Things alphabetical order. New tasks are inserted at the top of each backend column, while execution still proceeds from the bottom upward. |
| **Fresh elaboration per task** | Generate one new elaborated prompt for every (model × iteration) pair — all unique. Task creation is still round-robin by round, with cloud backends first in display order and Draw Things models after them in alphabetical order. New tasks are inserted at the top of each backend column, while execution still proceeds from the bottom upward. |

Elaborated prompts accumulate in a per-session list. The text AI sees previously elaborated prompts as context on each new request and avoids repeating them. The list persists across closing and reopening the modal, and is saved in `session.json` so it comes back when you resume that session later. Starting a different session still gives you that other session's own list.

Click **Elaborated (N)** below the elaborated prompt textarea — or open **☰ → Elaborated Prompts** — to open the manager. The list is numbered and shown newest-first so the latest prompt is immediately visible, while the underlying AI context remains chronological. Per-row **Delete** removes a prompt without confirmation; **Delete All** is gated by a confirm. Deletions affect future brainstorm calls — anything removed from the list is no longer presented to the text AI as something to avoid.

The modal stays open after queueing so you can run another round. Clicking outside it does not close it. Prompts are recorded in the elaborated-prompts list only once their tasks are queued (or, for a single **Elaborate**, once the result appears), so a run that is cancelled or fails partway leaves nothing behind. While an elaboration or queue operation is in flight, closing the modal asks for confirmation; confirming stops the in-flight generation and discards that run entirely. When nothing is running, you can close the modal with **Esc** or the close button.

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
| Templates | The three message formats sent to the AI; placeholders `{{ELABORATOR}}`, `{{SEED}}`, `{{PREVIOUS}}`, `{{N}}`, and `{{JSON}}` are substituted at call time. The shipped defaults wrap substituted content in explicit XML-like tags so models can see where embedded strings end. `{{JSON}}` is filled by the app and cannot be corrupted by editing the template. |

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
