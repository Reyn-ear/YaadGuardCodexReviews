#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-${COPERNICUS_SOURCE_DIR:-/Volumes/Games/InitToWinit26-terrain/sources/copernicus-dem-glo-30}}"
MANIFEST="${SOURCE_DIR}/source-manifest.json"
VRT="${SOURCE_DIR}/copernicus-dem-glo-30-caribbean.vrt"

if [[ ! -f "${MANIFEST}" ]] || [[ ! -f "${VRT}" ]]; then
  echo "Copernicus source is incomplete at ${SOURCE_DIR}" >&2
  exit 1
fi

jq -e '
  .sourceId == "T-01" and
  .dataset == "Copernicus DEM GLO-30" and
  .sourceVersion == "glo-30" and
  (.tileCount | type == "number" and . > 0)
' "${MANIFEST}" >/dev/null || {
  echo "Source manifest is not Copernicus DEM GLO-30" >&2
  exit 1
}

if find "${SOURCE_DIR}/tiles" -type f -name '*.tif' \
  ! -name 'Copernicus_DSM_COG_10_*_DEM.tif' -print -quit | grep -q .; then
  echo "Unexpected non-Copernicus raster filename in ${SOURCE_DIR}/tiles" >&2
  exit 1
fi

gdalinfo "${VRT}" >/dev/null
echo "Validated Copernicus DEM GLO-30 source at ${SOURCE_DIR}"
