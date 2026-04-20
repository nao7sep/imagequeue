# Draw Things Setup Guide for ImageQueue

ImageQueue supports **Draw Things** as a local image generation backend. This guide explains how to install and configure it.

## What is Draw Things?

[Draw Things](https://drawthings.ai) is a free macOS/iOS app for local AI image generation. It ships with a built-in CLI tool (`draw-things-cli`) that ImageQueue uses to generate images without any cloud API calls.

## Installation

### Step 1: Install the App

Download Draw Things from the Mac App Store:

- **Mac App Store**: Search "Draw Things" or visit <https://apps.apple.com/app/draw-things-ai-generation/id6444050820>

The app supports both Apple Silicon (M1/M2/M3/M4) and Intel Macs.

### Step 2: Locate the CLI Binary

Once installed, the CLI binary is bundled inside the app at:

```
/Applications/Draw Things.app/Contents/MacOS/draw-things-cli
```

If you installed from the App Store, the path may vary:

```
~/Library/Containers/com.liuliu.draw-things/Data/draw-things-cli
```

To verify the CLI is accessible, run:

```bash
"/Applications/Draw Things.app/Contents/MacOS/draw-things-cli" --help
```

### Step 3: Download a Model

Draw Things supports many models. For ImageQueue, we recommend starting with the default model configured in the app:

- **flux_1_schnell_q5p.ckpt** — Fast, lightweight FLUX Schnell variant

You can download models through the Draw Things GUI:

1. Open Draw Things
2. Go to the model picker
3. Download `FLUX.1 Schnell` (quantized q5p variant recommended for speed)

Models are stored in the Draw Things data directory. For ImageQueue, you can also specify a custom models directory.

## Configuration in ImageQueue

Open ImageQueue Settings (gear icon) and configure the Local backend:

| Field | Value |
|-------|-------|
| **CLI Path** | `/Applications/Draw Things.app/Contents/MacOS/draw-things-cli` |
| **Model** | `flux_1_schnell_q5p.ckpt` (or whichever model you downloaded) |
| **Models Dir** | `~/.imagequeue/models` (or Draw Things' default model directory) |
| **Steps** | 4–8 for Schnell, 20–30 for SD/SDXL models |
| **Width** | 1024 |
| **Height** | 1024 |

Alternatively, edit `~/.imagequeue/config.json` directly:

```json
{
  "image_backends": {
    "local": {
      "cli_path": "/Applications/Draw Things.app/Contents/MacOS/draw-things-cli",
      "model": "flux_1_schnell_q5p.ckpt",
      "default_params": {
        "steps": 4,
        "width": 1024,
        "height": 1024
      },
      "models_dir": "~/.imagequeue/models"
    }
  }
}
```

## CLI Arguments

ImageQueue invokes the CLI with these arguments:

```bash
draw-things-cli \
  --prompt "your prompt here" \
  --output /path/to/output.png \
  --model flux_1_schnell_q5p.ckpt \
  --models-dir ~/.imagequeue/models \
  --steps 4 \
  --width 1024 \
  --height 1024
```

## Supported Models

| Model | Type | Recommended Steps | Notes |
|-------|------|-------------------|-------|
| `flux_1_schnell_q5p.ckpt` | FLUX Schnell | 4 | Fast, good quality |
| `flux_1_dev_q8p.ckpt` | FLUX Dev | 20–28 | Higher quality, slower |
| `sd_xl_base_1.0_q6p.ckpt` | SDXL 1.0 | 25–30 | Classic Stable Diffusion XL |
| `sd3_medium_q8p.ckpt` | SD3 Medium | 28 | Stable Diffusion 3 |

Check the Draw Things app for the full list of available models.

## Troubleshooting

### "Failed to spawn draw-things-cli"

- Verify the CLI path is correct
- Ensure the app is installed (the CLI is inside the .app bundle)
- Try running the CLI manually in Terminal to check for errors

### "draw-things-cli exited with code 1"

- Check that the specified model file exists in the models directory
- Ensure you have enough disk space and RAM for the model
- Try running with fewer steps or smaller dimensions

### Models directory is empty

If you set a custom `models_dir`, you need to either:
1. Copy/symlink model files from Draw Things' default location
2. Or point `models_dir` to where Draw Things stores its models:
   - Default: `~/Library/Containers/com.liuliu.draw-things/Data/models/`

### Performance Tips

- **Apple Silicon**: Draw Things uses Metal/GPU acceleration automatically
- **RAM**: FLUX Schnell q5p needs ~6GB RAM; larger models need more
- **Concurrency**: Local backend runs sequentially (concurrency = 1) since GPU is shared
- **Steps**: Schnell models work well with just 4 steps; don't over-step

## Alternative: API Server Mode

Draw Things also supports an HTTP API server mode:

```bash
"/Applications/Draw Things.app/Contents/MacOS/Draw Things" --api-server
```

This starts a server on `http://127.0.0.1:3210` with endpoints like `/v1/txt2img`. ImageQueue currently uses the CLI approach (not the API server), but this is noted for reference.
