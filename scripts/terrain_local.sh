#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/terrain/cache/venv"

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --requirement "$ROOT/terrain/requirements.txt"
fi

for command in pmtiles martin; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "terrain-local: required command is not installed: $command" >&2
    exit 1
  fi
done

exec "$VENV/bin/python" "$ROOT/scripts/terrain_release.py" "$@"
