# Draw Things in ImageQueue

ImageQueue can generate images locally through the Draw Things CLI. No API key is required; generation happens on your Mac.

## At a glance

- macOS only
- one Draw Things generation runs at a time
- model downloads and imports run in the floating jobs panel
- imports are serialized

## 1. Install and configure the CLI

Install Draw Things CLI with Homebrew:

```sh
brew install drawthingsai/draw-things/draw-things-cli
```

Check that it works:

```sh
draw-things-cli --version
```

### Settings → Draw Things

| Setting | Default | Description |
|---|---|---|
| `cli_path` | empty | Full path to the CLI if it is not on `$PATH` |
| `models_dir` | `~/.imagequeue/models` | Directory where ImageQueue stores Draw Things models |
| `auto_update_recommendations` | `true` | Download the latest Draw Things recommendation file at launch |
| `fallback_width` | `1024` | Width used when no recommendation applies |
| `fallback_height` | `1024` | Height used when no recommendation applies |
| `fallback_steps` | `4` | Steps used when no recommendation applies |
| `fallback_guidance` | `1` | Guidance used when no recommendation applies |
| `fallback_negative_prompt` | empty | Negative prompt used when no recommendation applies |
| `seed` | `null` | Fallback seed; `null` or `0` both mean random |

### Models directory rules

ImageQueue resolves the models directory like this:

1. use `models_dir` if you set it in Settings
2. otherwise use `~/.imagequeue/models`

ImageQueue always passes `--models-dir` to the CLI. It does not guess or probe Draw Things GUI app storage on its own.

## 2. How model state works

This is the part that matters most when models seem confusing.

### Catalog models

The model browser gets Draw Things model metadata from `draw-things-cli models list`.

### Local imports

The **Local Imports** section is based on `custom.json` inside the models directory. That file is Draw Things' own record of imported external models, so it is the main source of truth. If `custom.json` is missing or unreadable, ImageQueue falls back to a name-based heuristic.

That means the modal is usually reliable about showing imported models, but duplicate prevention is still ultimately enforced by Draw Things CLI itself.

### Saved per-model parameters

ImageQueue remembers the last-used Draw Things values per model in:

```text
~/.imagequeue/params.json
```

This file lives at the data directory root because it is owned by ImageQueue, not Draw Things. Saved values win over recommendations when you come back to the same model.

### Recommendations

ImageQueue can download or import Draw Things recommendation data. The file is stored at:

```text
~/.imagequeue/data/configs.json
```

Recommendations fill the starting values for width, height, steps, guidance, and negative prompt. They do not secretly override your current controls. If you change the values and want to go back, the Draw Things column shows **Use recommended**.

When two or more models are downloaded and at least one of them has a different width, height, steps, or guidance than the current values, the Draw Things column shows **Apply to all models** between the guidance and seed rows. Clicking it copies the current width, height, steps, and guidance into every downloaded model's saved parameters; each model keeps its own seed and negative prompt. The button hides again once every other model matches.

## 3. Common workflows

### Download an official model

1. Open **☰ → Draw Things Models**.
2. Find a model in **Official Models** or **Community Catalog**.
3. Click **Download**.

What happens:

- the floating jobs panel shows live progress
- the final log stays visible until dismissed
- downloading the same model again resumes instead of restarting from scratch

### Import a local model file

1. Download the `.safetensors` or other model artifact you want to import.
2. Open **☰ → Draw Things Models**.
3. In **Import Local Model**, browse for the file or paste its path.
4. Click **Import**.

What happens:

- the jobs panel runs `draw-things-cli models import`
- imports queue one at a time
- if the model was already imported, the import fails instead of overwriting it
- when import succeeds, the model should appear under **Local Imports**

### Generate with a downloaded/imported model

1. Pick a downloaded model in the Draw Things column.
2. Adjust size, steps, guidance, seed, or negative prompt.
3. Queue the prompt.

What happens:

- current control values are what get sent to the CLI
- if a recommendation exists, it only sets the starting values
- your edited values are saved per model for later reuse

## 4. What ImageQueue sends to Draw Things CLI

Each generation runs `draw-things-cli generate`. Output is written to a temporary PNG in the session directory, read back into the app, then deleted.

| CLI flag | Source |
|---|---|
| `--model` | Selected model |
| `--prompt` | Prompt text |
| `--output` | Temporary session file |
| `--width` / `--height` | Current size controls |
| `--steps` | Current steps control |
| `--cfg` | Current guidance control |
| `--seed` | Current seed control, omitted when random |
| `--negative-prompt` | Current negative prompt, omitted when empty |
| `--disable-preview` | Always set |
| `--models-dir` | Always set |

## 5. Troubleshooting

### `draw-things-cli` is not found

- Install it with Homebrew, or set `cli_path` explicitly in Settings.
- Confirm it works in Terminal with `draw-things-cli --version`.

### A model does not appear in the Draw Things column

- The column only shows downloaded models.
- Open the Models modal and confirm the model exists in the configured `models_dir`.

### A model is missing from Local Imports

- Check whether `custom.json` exists in the models directory and contains the imported file.
- If `custom.json` is unavailable, ImageQueue falls back to a heuristic and may be less certain.

### Import says the model already exists

- That usually means Draw Things already knows about the model.
- Check **Local Imports** in the Models modal before trying to import again.

### Generation fails with `model not found`

- The selected task refers to a model file that is not present in the active models directory.
- Download or import the model again, or correct `models_dir`.

### Draw Things feels slow

- Speed depends on model size, steps, resolution, and your Mac's hardware.
- Distilled models such as FLUX 2 Klein are intended for low step counts.
