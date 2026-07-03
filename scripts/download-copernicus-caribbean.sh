#!/usr/bin/env bash
set -euo pipefail

ROOT="${TERRAIN_ROOT:-/Volumes/Games/InitToWinit26-terrain}"
SOURCE_DIR="${COPERNICUS_SOURCE_DIR:-${ROOT}/sources/copernicus-dem-glo-30}"
TILES_DIR="${SOURCE_DIR}/tiles"
BASE_URL="https://copernicus-dem-30m.s3.amazonaws.com"
WEST="${CARIBBEAN_WEST:--90}"
SOUTH="${CARIBBEAN_SOUTH:-9}"
EAST="${CARIBBEAN_EAST:--58}"
NORTH="${CARIBBEAN_NORTH:-33}"

mkdir -p "${TILES_DIR}"

format_lat() {
  local value="$1"
  if (( value >= 0 )); then
    printf 'N%02d_00' "${value}"
  else
    printf 'S%02d_00' "$((-value))"
  fi
}

format_lon() {
  local value="$1"
  if (( value >= 0 )); then
    printf 'E%03d_00' "${value}"
  else
    printf 'W%03d_00' "$((-value))"
  fi
}

downloaded=0
missing=0
for ((lat = SOUTH; lat < NORTH; lat++)); do
  for ((lon = WEST; lon < EAST; lon++)); do
    lat_name="$(format_lat "${lat}")"
    lon_name="$(format_lon "${lon}")"
    tile="Copernicus_DSM_COG_10_${lat_name}_${lon_name}_DEM"
    target="${TILES_DIR}/${tile}.tif"

    if [[ -s "${target}" ]] && gdalinfo "${target}" >/dev/null 2>&1; then
      continue
    fi

    url="${BASE_URL}/${tile}/${tile}.tif"
    temporary="${target}.part"
    if curl --fail --location --retry 4 --retry-delay 2 \
      --output "${temporary}" "${url}"; then
      gdalinfo "${temporary}" >/dev/null
      mv "${temporary}" "${target}"
      downloaded=$((downloaded + 1))
    else
      rm -f "${temporary}"
      missing=$((missing + 1))
    fi
  done
done

mapfile_path="${SOURCE_DIR}/tiles.txt"
find "${TILES_DIR}" -type f -name 'Copernicus_DSM_COG_10_*_DEM.tif' \
  -print | sort >"${mapfile_path}"

if [[ ! -s "${mapfile_path}" ]]; then
  echo "No valid Copernicus GLO-30 tiles were downloaded" >&2
  exit 1
fi

gdalbuildvrt -overwrite -input_file_list "${mapfile_path}" \
  "${SOURCE_DIR}/copernicus-dem-glo-30-caribbean.vrt"

tile_count="$(wc -l <"${mapfile_path}" | tr -d ' ')"
cat >"${SOURCE_DIR}/source-manifest.json" <<EOF
{
  "sourceId": "T-01",
  "dataset": "Copernicus DEM GLO-30",
  "provider": "Copernicus / ESA",
  "collection": "Copernicus DEM 30m COG tiles",
  "sourceVersion": "glo-30",
  "registryUrl": "https://registry.opendata.aws/copernicus-dem/",
  "bucketUrl": "${BASE_URL}",
  "retrievedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bounds": [${WEST}, ${SOUTH}, ${EAST}, ${NORTH}],
  "tileCount": ${tile_count},
  "missingOceanTiles": ${missing},
  "localVrtPath": "${SOURCE_DIR}/copernicus-dem-glo-30-caribbean.vrt"
}
EOF

echo "Copernicus source ready: ${tile_count} tiles (${downloaded} downloaded)"
