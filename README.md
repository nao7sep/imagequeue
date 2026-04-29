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

Each backend also has its own section for the API key and default generation parameters.

## Working with Images

When a completed task is selected, a toolbar appears below the preview:

| Button | Description |
|---|---|
| **Copy Prompt** | Copies the task's prompt text to the clipboard. |
| **Reveal** | Opens the file manager (Finder, Explorer, etc.) and highlights the image file. |
| **Copy to Clipboard** | Copies the image itself to the clipboard. |
| **Export** | Saves a copy to the export folder (configurable in General settings; defaults to Desktop). Auto-renames on collision. |
| **Save As…** | Opens a save dialog so you can pick the destination and filename. |

For quick bulk actions, each completed task row also has an **exp** button that exports the image to the export folder. Use **Open Output Folder** in the hamburger menu (☰) to open the output directory and browse all sessions.

Below the toolbar, a collapsible details strip shows the model and prompt at a glance. Click it to expand the full task metadata (status, cost, time, generation parameters); click anywhere on the expanded panel to collapse it again.

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|---|---|---|
| Send to all backends | ⌘↩ | Ctrl+Enter |
| Send to backend 1–6 | ⌘1–6 | Ctrl+1–6 |
| Open Settings | ⌘, | Ctrl+, |
| Move selection up / down within a column | ↑ / ↓ | ↑ / ↓ |
| Move selection to nearest task in adjacent column | ← / → | ← / → |
| Remove selected task from queue (keep files) | Backspace | Backspace |
| Delete selected task and its files | Delete | Delete |
| Clear selection / close panel | Esc | Esc |

## Draw Things (local)

See [docs/draw-things-cli.md](docs/draw-things-cli.md) for setup and usage.

## License

MIT
