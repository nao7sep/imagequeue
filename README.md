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

Open Settings with **⌘,** (macOS) or **Ctrl+,** (Windows/Linux). Each backend has its own section for the API key and default generation parameters.

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|---|---|---|
| Send to all backends | ⌘↩ | Ctrl+Enter |
| Send to backend 1–6 | ⌘1–6 | Ctrl+1–6 |
| Open Settings | ⌘, | Ctrl+, |

## Draw Things (local)

See [docs/draw-things.md](docs/draw-things.md) for setup and usage.

## License

MIT
