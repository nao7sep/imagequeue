#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
pause_on_failure() {
  local status="$?"
  if [[ "$status" -ne 0 && "$status" -ne 130 ]]; then
    echo "ImageQueue rebuild failed."
    read -r -p "Press Enter to close..."
  fi
}
trap pause_on_failure EXIT
if ! command -v node >/dev/null 2>&1; then
  echo "Missing required command: node" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Missing required command: npm" >&2
  exit 1
fi
node "$SCRIPT_DIR/launcher.mjs" rebuild
