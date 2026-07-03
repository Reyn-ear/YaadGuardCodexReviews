#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
OUTPUT_DIR="${2:-}"
COPERNICUS_DIR="${COPERNICUS_SOURCE_DIR:-/Volumes/Games/InitToWinit26-terrain/sources/copernicus-dem-glo-30}"

if [[ -z "${SOURCE_DIR}" ]] || [[ -z "${OUTPUT_DIR}" ]]; then
  echo "Usage: npm run terrain:prepare-webp -- SOURCE_RELEASE OUTPUT_RELEASE" >&2
  exit 2
fi

command -v cwebp >/dev/null || {
  echo "cwebp is required (brew install webp)" >&2
  exit 2
}

"$(dirname "$0")/validate-copernicus-source.sh" "${COPERNICUS_DIR}"

if [[ ! -d "${SOURCE_DIR}/tiles" ]]; then
  echo "Missing source tile tree at ${SOURCE_DIR}/tiles" >&2
  exit 2
fi

mkdir -p "${OUTPUT_DIR}/tiles"

while IFS= read -r -d '' source; do
  relative="${source#"${SOURCE_DIR}/tiles/"}"
  target="${OUTPUT_DIR}/tiles/${relative%.png}.webp"
  mkdir -p "$(dirname "${target}")"
  cwebp -quiet -lossless -exact -metadata none "${source}" -o "${target}"
done < <(find "${SOURCE_DIR}/tiles" -type f -name '*.png' -print0)

for artifact in elevation-grids terrain-summaries; do
  if [[ -d "${SOURCE_DIR}/${artifact}" ]]; then
    mkdir -p "${OUTPUT_DIR}/${artifact}"
    cp -R "${SOURCE_DIR}/${artifact}/." "${OUTPUT_DIR}/${artifact}/"
  fi
done

mkdir -p "${OUTPUT_DIR}/provenance"
cp "${COPERNICUS_DIR}/source-manifest.json" \
  "${OUTPUT_DIR}/provenance/source-manifest.json"

echo "Prepared lossless WebP release at ${OUTPUT_DIR}"
