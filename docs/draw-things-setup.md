# Draw Things Setup Guide for ImageQueue

ImageQueue supports **Draw Things** as a local image generation backend. This guide explains how to install and configure it.

## What is Draw Things?

[Draw Things](https://drawthings.ai) is a free macOS/iOS app for local AI image generation. The separate `draw-things-cli` tool provides command-line access that ImageQueue uses to generate images without any cloud API calls.

## Installation

### Step 1: Install draw-things-cli via Homebrew

```bash
brew install drawthingsai/draw-things/draw-things-cli
```

Verify it works:

```bash
draw-things-cli --version
draw-things-cli generate --help
```

### Step 2: Download a Model

List available models and download one:

```bash
# See what's already downloaded
draw-things-cli models list --downloaded-only

# Download a recommended model (auto-downloads on first use too)
draw-things-cli models ensure --model flux_2_klein_4b_q6p.ckpt
```

Models are stored in:
- **macOS**: `~/Library/Containers/com.liuliu.draw-things/Data/Documents/Models`
- **Custom**: Set via `--models-dir` flag or `DRAWTHINGS_MODELS_DIR` env var

### Step 3: Test Generation

```bash
draw-things-cli generate \
  --model flux_2_klein_4b_q6p.ckpt \
  --prompt "a red cube on a table" \
  --output test.png \
  --steps 4 \
  --width 1024 \
  --height 1024 \
  --disable-preview
```

## Configuration in ImageQueue

Open ImageQueue Settings (gear icon) and configure the Local backend:

| Field | Value |
|-------|-------|
| **CLI Path** | `draw-things-cli` (if installed via Homebrew, it's in PATH) |
| **Model** | `flux_2_klein_4b_q6p.ckpt` (or any downloaded model) |
| **Models Dir** | Leave empty to use default, or set a custom path |
| **Steps** | 4 for FLUX Schnell/Klein, 20–28 for FLUX Dev, 25–30 for SDXL |
| **Width** | 1024 (must be multiple of 64) |
| **Height** | 1024 (must be multiple of 64) |

Alternatively, edit `~/.imagequeue/config.json` directly:

```json
{
  "image_backends": {
    "local": {
      "cli_path": "draw-things-cli",
      "model": "flux_2_klein_4b_q6p.ckpt",
      "default_params": {
        "steps": 4,
        "width": 1024,
        "height": 1024
      },
      "models_dir": ""
    }
  }
}
```

## How ImageQueue Invokes the CLI

```bash
draw-things-cli generate \
  --model flux_2_klein_4b_q6p.ckpt \
  --prompt "your prompt here" \
  --output /path/to/temp_output.png \
  --steps 4 \
  --width 1024 \
  --height 1024 \
  --disable-preview \
  --models-dir /custom/path  # only if models_dir is set
```

## Model References

The `--model` flag accepts multiple formats:

| Format | Example |
|--------|---------|
| File ID | `flux_2_klein_4b_q6p.ckpt` |
| Human name | `"FLUX.2 [klein] 4B (6-bit)"` |
| Hugging Face | `hf://owner/repo` or `owner/repo` |

## Recommended Models

| Model | Type | Steps | Notes |
|-------|------|-------|-------|
| `flux_2_klein_4b_q6p.ckpt` | FLUX.2 Klein 4B | 4 | Fast, small, recommended starter |
| `flux_1_schnell_q5p.ckpt` | FLUX.1 Schnell | 4 | Fast generation |
| `flux_2_dev_q8p.ckpt` | FLUX.2 Dev | 20–28 | Higher quality, slower |
| `sd_xl_base_1.0_q6p.ckpt` | SDXL 1.0 | 25–30 | Classic Stable Diffusion XL |
| `sd3_medium_q8p.ckpt` | SD3 Medium | 28 | Stable Diffusion 3 |

To download any model:
```bash
draw-things-cli models ensure --model <model-id>
```

## Troubleshooting

### "Failed to spawn draw-things-cli"

- Verify installation: `which draw-things-cli`
- If not found, reinstall: `brew install drawthingsai/draw-things/draw-things-cli`

### "draw-things-cli exited with code 1"

- Check that the model exists: `draw-things-cli models list --downloaded-only`
- Download if missing: `draw-things-cli models ensure --model <model>`
- Ensure width/height are multiples of 64

### Model auto-download

By default, `draw-things-cli generate` will auto-download missing models. To disable this behavior, add `--no-download-missing` to the command. ImageQueue does not currently pass this flag, so models will download automatically on first use.

### Performance Tips

- **Apple Silicon**: Uses Metal/GPU acceleration automatically
- **RAM**: Klein 4B q6p needs ~4-6GB; larger models need more
- **Concurrency**: Local backend runs sequentially (concurrency = 1) since GPU is shared
- **Steps**: FLUX Schnell/Klein work well with just 4 steps

## Optional: Draw Things GUI App

The Mac App Store app (`Draw Things`) is a separate GUI application. It shares the same models directory but is **not required** for CLI usage. Install it only if you want the visual interface for experimenting with settings.
