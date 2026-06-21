# ImageQueue

ImageQueue is a desktop app for comparing image-generation backends side by side. Write one prompt, queue it to a single backend or all of them at once, then review, export, and compare the results in one place. It's for anyone evaluating or mixing image models — cloud services (OpenAI GPT Image, Google Imagen, Nano Banana, Grok, FLUX) and local Draw Things on macOS — without juggling separate tools. An Electron app for macOS, Windows, and Linux, with a queue, saved sessions, and optional AI prompt elaboration.

## Backends

| Backend | API key |
|---|---|
| OpenAI GPT Image | Required |
| Google Imagen | Required |
| Nano Banana (Gemini) | Required |
| Grok Imagine | Required |
| FLUX (Black Forest Labs) | Required |
| Draw Things (local, macOS only) | Not required |

## Features

- **Side-by-side queue** — one prompt to one backend or all; review queued, running, completed, failed, and interrupted tasks per column
- **Sessions** — each launch is a saved session you can resume; interrupted work returns ready to retry
- **Advanced Prompting** — batch across backends and models with optional AI-elaborated prompt variations and reusable elaborators
- **Cost estimates** — rough pre-run cost for the proprietary backends
- **Stays awake during long runs**, with optional toast and sound notifications on completion

## Requirements

- Node.js 20+
- macOS, Windows, or Linux (Draw Things support is macOS-only)
- An API key for each cloud backend you use; Draw Things needs none

## Getting started

Double-click the launcher for your platform (`scripts/run-dev.command` on macOS, `scripts/run-dev.ps1` on Windows), or run from source:

```sh
npm install
npm run dev
```

## License

MIT © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — nao7sep@gmail.com
