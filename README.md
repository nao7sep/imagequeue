# ImageQueue

A desktop app for batch image generation across multiple AI backends. Send a prompt to all backends at once and compare results side-by-side.

## Backends

| Backend | API Key Required |
|---|---|
| OpenAI GPT Image | ✓ |
| Google Imagen | ✓ |
| FLUX (Black Forest Labs) | ✓ |
| Nano Banana (Gemini) | ✓ |
| Grok Imagine | ✓ |
| Draw Things (local CLI) | — macOS only |

## Requirements

- Node.js 18+
- macOS, Windows, or Linux (Draw Things backend is macOS-only)

## Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

## Type Check

```sh
npm run typecheck
```

## Configuration

Open Settings with **⌘,** (macOS) or **Ctrl+,** (Windows/Linux).

**General** — app-wide behavior settings:

| Setting | Default | Description |
|---|---|---|
| Auto-preview after idle | 30 s | Auto-selects a newly completed image after this many seconds of inactivity. Set to 0 to disable. |
| Export folder | (Desktop) | Directory where the **Export** button saves images. Leave empty to use the Desktop. |
| Confirm before removing | Off | Show a confirmation dialog before removing a task from the queue (Backspace / rm). |
| Confirm before deleting | Off | Show a confirmation dialog before deleting a task and its files (Delete / del). |
| Move deleted files to Trash | On | Send deleted files to the system Trash instead of permanently deleting them. |

Each cloud backend also has its own section with:

| Setting | Description |
|---|---|
| Model | Which model variant to use for generation. |
| Concurrency | How many simultaneous requests ImageQueue can send to that backend (default 3). |
| Timeout | Maximum time to wait for a response before failing the task (default 180 s). |

Some backends expose additional parameters: quality and output format (GPT Image); aspect ratio and image size (Imagen and Grok); inference steps (FLUX). Draw Things settings are documented separately in [docs/draw-things-cli.md](docs/draw-things-cli.md).

## Text AI

ImageQueue uses a text AI model to generate a short filename slug from each prompt. The slug appears in the output filename (e.g., `20260501-123456-red-fox-on-snow-openai.png`) and makes images easy to identify at a glance. If the AI call fails or times out, ImageQueue falls back to a random ID automatically.

Configure this in **Settings → Text AI**:

| Setting | Default | Description |
|---|---|---|
| Backend | Gemini | AI service used for slug generation. |
| API Key | — | API key for the selected backend. |
| Model | Gemini 3.1 Flash Lite (Preview) | Model used for slug generation. A fast, inexpensive model is ideal for this task. |
| Timeout | 30 s | Maximum wait time before falling back to a random ID. |

The **Prompts → Slug template** setting (also in Settings) holds the instruction sent to the AI. The default works well for most prompts; edit it only if you want to customise the slug format.

## Working with Images

When a completed task is selected, a toolbar appears below the preview:

| Button | Description |
|---|---|
| **Copy Prompt** | Copies the task's prompt text to the clipboard. |
| **Reveal** | Opens the file manager (Finder, Explorer, etc.) and highlights the image file. |
| **Copy to Clipboard** | Copies the image itself to the clipboard. |
| **Export** | Saves a copy to the export folder (configurable in General settings; defaults to Desktop). Auto-renames on collision. |
| **Save As…** | Opens a save dialog so you can pick the destination and filename. |

For quick bulk actions, each completed task row also has an **exp** button that exports the image to the export folder.

Below the toolbar, a collapsible details strip shows the model and prompt at a glance. Click it to expand the full task metadata (status, cost, time, generation parameters); click anywhere on the expanded panel to collapse it again.

## Menu (☰)

The hamburger menu (☰) in the top-left gives access to:

| Item | Description |
|---|---|
| Open Output Folder | Opens the directory where all session output folders are stored. |
| Settings | Opens the Settings dialog (also **⌘,** / **Ctrl+,**). |
| Draw Things Models | Opens the model browser and downloader. macOS only. |
| Keyboard Shortcuts | Opens the keyboard shortcut reference. |
| About | Shows the app version and links. |

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|---|---|---|
| Send to all backends | ⌘↩ | Ctrl+Enter |
| Send to backend 1–6 | ⌘1–6 | Ctrl+1–6 |
| Open Settings | ⌘, | Ctrl+, |
| Move selection up / down within a column | ↑ / ↓ | ↑ / ↓ |
| Move selection to nearest task in adjacent column | ← / → | ← / → |
| Open fullscreen image viewer | Space | Space |
| Close fullscreen image viewer | Space or Esc | Space or Esc |
| Remove selected task from queue (keep files) | Backspace | Backspace |
| Delete selected task and its files | Delete | Delete |
| Clear selection / close panel | Esc | Esc |

## Draw Things (local)

See [docs/draw-things-cli.md](docs/draw-things-cli.md) for setup and usage.

## License

MIT. See [LICENSE](LICENSE).
