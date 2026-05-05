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

- Node.js 18+
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

## Everyday workflow

1. Enter a prompt.
2. Choose a backend column, or use **Send to All**.
3. Review queued, running, completed, failed, and interrupted tasks in each column.
4. Select a completed task to preview, inspect metadata, export, reveal, or copy it.

## Sessions

Each app launch creates a session folder under the output directory. ImageQueue writes a `session.json` snapshot there as queue state changes, so you can later reopen that session from the menu.

- **New Session** switches to a fresh empty session without needing another app window.
- **Resume** restores completed outputs as-is and brings unfinished work back as interrupted tasks with **retry** available.
- **Delete** removes that session folder according to the **Delete to Trash** setting.
- Current-session resume is intentionally minimal: it restores task history and outputs, not transient UI state such as the current prompt or selection.
- Only sessions with a readable `session.json` snapshot appear.
- Session previews currently read the original output images directly. Cached thumbnail files are intentionally not generated yet; if browsing later becomes measurably slow, add relative thumbnail paths in `session.json` and generate missing thumbs on demand.

## Settings overview

Open Settings with **⌘,** (macOS) or **Ctrl+,** (Windows/Linux).

### General

| Setting | Default | Description |
|---|---|---|
| Auto-preview after idle | 30 s | Auto-selects a newly completed image after this many seconds of inactivity. Set to 0 to disable. |
| Export folder | Desktop | Directory where **Export** saves images. Leave empty to use the Desktop. |
| Confirm before removing | Off | Confirm before removing a task from the queue, or keeping a completed image just in case. |
| Confirm before deleting | Off | Confirm before deleting a task and its files. |
| Move deleted files to Trash | On | Send deleted task files and session folders to the system Trash instead of permanently deleting them. |

### Cloud backends

Each cloud backend has its own section with:

| Setting | Description |
|---|---|
| Model | Which model variant to use |
| Concurrency | How many simultaneous requests ImageQueue may send |
| Timeout | Maximum wait time before failing a task |

Some backends also expose backend-specific generation parameters such as quality, aspect ratio, image size, steps, guidance, or seed.

### Draw Things

Draw Things has its own setup and workflow guide in [docs/draw-things-cli.md](docs/draw-things-cli.md).

### Text AI

ImageQueue uses a text AI model to create short filename slugs from prompts. If slug generation fails or times out, ImageQueue falls back to a random ID automatically.

| Setting | Default | Description |
|---|---|---|
| Backend | Gemini | AI service used for slug generation |
| API Key | — | API key for the selected backend |
| Model | Gemini 3.1 Flash Lite (Preview) | Model used for slug generation |
| Timeout | 30 s | Maximum wait time before falling back to a random ID |

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

Each completed task row also has **exp** for quick export, **jic** to keep the image just in case while removing it from the active list, and **del** to delete the task and its files.

Removing a queued, failed, or interrupted task drops it from the queue. Using **jic** on a completed task keeps that output in session history but removes it from the active list.

Below the toolbar, a collapsible details strip shows the model and prompt at a glance. Expand it for full metadata such as status, cost, duration, and generation parameters.

## Menu

The hamburger menu (☰) gives access to:

| Item | Description |
|---|---|
| Open Output Folder | Open the directory that stores session outputs |
| Sessions | Browse saved sessions, resume one, or delete one |
| Settings | Open Settings |
| Draw Things Models | Open the Draw Things model browser and importer |
| Keyboard Shortcuts | Open the shortcut reference |
| About | Show version and links |

## Keyboard shortcuts

| Action | macOS | Windows/Linux |
|---|---|---|
| Send to all backends | ⌘↩ | Ctrl+Enter |
| Send to backend 1–6 | ⌘1–6 | Ctrl+1–6 |
| Open Settings | ⌘, | Ctrl+, |
| Move selection within a column | ↑ / ↓ | ↑ / ↓ |
| Move selection across columns | ← / → | ← / → |
| Open fullscreen image viewer | Space | Space |
| Close fullscreen image viewer | Space or Esc | Space or Esc |
| Remove selected task, or keep the selected completed image just in case | Backspace | Backspace |
| Delete selected task and files | Delete | Delete |
| Clear selection / close panel | Esc | Esc |

## Draw Things

See [docs/draw-things-cli.md](docs/draw-things-cli.md) for local model management, recommendation behavior, and generation details.

## License

MIT. See [LICENSE](LICENSE).
