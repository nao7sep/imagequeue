# ImageQueue

ImageQueue is a desktop app for comparing image-generation backends side by side. Write one prompt, queue it to a single backend or all of them at once, then review, export, and compare the results in one place. It's for anyone evaluating or mixing image models — cloud services (OpenAI GPT Image, Nano Banana, Grok, FLUX) and local Draw Things on macOS — without juggling separate tools. An Electron app for macOS and Windows, with a queue, saved sessions, and optional AI prompt elaboration.

## Backends

| Backend | API key |
|---|---|
| OpenAI GPT Image | Required |
| Nano Banana (Gemini) | Required |
| Grok Imagine | Required |
| FLUX (Black Forest Labs) | Required |
| Draw Things (local, macOS only) | Not required |

## Features

- **Side-by-side queue** — one prompt to one backend or all; review queued, running, completed, failed, interrupted, and kept tasks per column
- **Sessions** — each launch is a saved session you can resume; interrupted work returns ready to retry
- **Advanced Prompting** — batch across backends and models with AI-elaborated prompt variations, reusable elaborators, and a persistent **Concept Library** that guarantees the elaborated prompts keep varying instead of collapsing onto the model's favourite ideas
- **Stays awake during long runs**, with optional toast and sound notifications on completion

## Requirements

- macOS or Windows (Draw Things support is macOS-only)
- An API key for each cloud image backend you use.
- Prompt elaboration (the Elaborate button and Advanced Prompting's fresh-elaboration modes) additionally needs a **Text AI** key — OpenAI or Gemini, configured in **Settings → Text AI**. It is separate from the image keys: an image key does not enable it. Without one, images still generate from your prompt as typed.
- Draw Things needs no API key. On macOS it uses two app-managed dependencies, both installed from the **Dependencies** window (main menu → Dependencies, or the pointer in the Draw Things column):
  - The **Draw Things CLI** — currently about 170 MB, downloaded directly from its official GitHub release (no Homebrew), and verified before use; the backend stays disabled until it's installed.
  - **Recommended per-model parameters** (`configs.json`, fetched from `models.drawthings.ai`) — optional; without them the app falls back to your default parameters.
- Both are fetched only when you ask. The CLI can check release metadata at launch (on by default, configurable in the Dependencies window) and offer an **Update** without downloading the binary. The versionless recommendations file is fetched only when you choose **Install** or **Refresh** — nothing is ever downloaded, installed, or updated silently.
- Node.js 20.19+ (or 22.12+) — only to build or run from source

## Download

Prebuilt installers and portable builds for macOS (Apple Silicon) and Windows are on the [Releases](https://github.com/nao7sep/imagequeue/releases/latest) page. These builds are **unsigned**, so the OS warns the first time you open one:

- **macOS** — open it once (it will be blocked), then allow it under **System Settings → Privacy & Security → Open Anyway** (or run `xattr -dr com.apple.quarantine /Applications/ImageQueue.app`).
- **Windows** — on the SmartScreen prompt, click **More info → Run anyway**.

## Run from source

Double-click the launcher for your platform (`scripts/run-dev.command` on macOS, `scripts/run-dev.ps1` on Windows), or run it by hand:

```sh
npm install
npm run dev
```

## License

MIT © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — yoshinao@inoguchi.com — <https://inoguchi.com>
