#!/usr/bin/env bash
set -euo pipefail

ROOT="${TERRAIN_ROOT:-/Volumes/Games/InitToWinit26-terrain}"
RELEASE_DIR="${1:-}"
BUCKET="${R2_BUCKET:-yaad-guard-artifacts}"
RUN_ID="${RUN_ID:-terrain_$(date -u +%Y%m%dT%H%M%SZ)}"
PREFIX="data"
EXCLUDED_TILE_PREFIX="tiles/13/"
MAX_UPLOAD_ATTEMPTS="${R2_UPLOAD_ATTEMPTS:-6}"
RETRY_BASE_SECONDS="${R2_RETRY_BASE_SECONDS:-2}"
UPLOAD_CONCURRENCY="${R2_UPLOAD_CONCURRENCY:-1}"
STATE_DIR="${RELEASE_DIR}/.publish"
STATE_FILE="${STATE_DIR}/${RUN_ID}.uploaded"
STATE_PARTS_DIR="${STATE_DIR}/${RUN_ID}.parts"

if [[ -z "${RELEASE_DIR}" ]]; then
  echo "Usage: npm run terrain:publish -- /Volumes/Games/.../release-directory" >&2
  exit 2
fi

if ! [[ "${MAX_UPLOAD_ATTEMPTS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "R2_UPLOAD_ATTEMPTS must be a positive integer" >&2
  exit 2
fi

if ! [[ "${RETRY_BASE_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "R2_RETRY_BASE_SECONDS must be a positive integer" >&2
  exit 2
fi

if ! [[ "${UPLOAD_CONCURRENCY}" =~ ^[1-9][0-9]*$ ]]; then
  echo "R2_UPLOAD_CONCURRENCY must be a positive integer" >&2
  exit 2
fi

if [[ "${RELEASE_DIR}" != "${ROOT}"/* ]]; then
  echo "Release directory must be under ${ROOT}" >&2
  exit 2
fi

SOURCE_MANIFEST="${RELEASE_DIR}/provenance/source-manifest.json"
if [[ ! -f "${SOURCE_MANIFEST}" ]] || ! jq -e '
  .sourceId == "T-01" and
  .dataset == "Copernicus DEM GLO-30" and
  .sourceVersion == "glo-30"
' "${SOURCE_MANIFEST}" >/dev/null; then
  echo "Refusing to publish: release provenance is not Copernicus DEM GLO-30" >&2
  exit 2
fi

node "$(dirname "$0")/validate-terrain-release.mjs" "${RELEASE_DIR}"

if [[ ! -d "${RELEASE_DIR}/tiles" ]] || ! find "${RELEASE_DIR}/tiles" -name '*.webp' -print -quit | grep -q .; then
  echo "Missing WebP tile tree at ${RELEASE_DIR}/tiles/{z}/{x}/{y}.webp" >&2
  exit 2
fi

if [[ ! -d "${RELEASE_DIR}/elevation-grids" ]] || ! find "${RELEASE_DIR}/elevation-grids" -name '*.json' -print -quit | grep -q .; then
  echo "Missing elevation JSON tree at ${RELEASE_DIR}/elevation-grids" >&2
  exit 2
fi

mkdir -p "${STATE_DIR}"
touch "${STATE_FILE}"
rm -rf "${STATE_PARTS_DIR}"
mkdir -p "${STATE_PARTS_DIR}"

upload_object() {
  local file="$1"
  local object_key="$2"
  local content_type="$3"
  local attempt=1
  local delay="${RETRY_BASE_SECONDS}"

  while true; do
    if npx wrangler r2 object put "${BUCKET}/${object_key}" \
      --file "${file}" \
      --content-type "${content_type}" \
      --remote; then
      return 0
    fi

    if (( attempt >= MAX_UPLOAD_ATTEMPTS )); then
      echo "Upload failed after ${attempt} attempts: ${object_key}" >&2
      return 1
    fi

    echo "Upload attempt ${attempt} failed; retrying in ${delay}s: ${object_key}" >&2
    sleep "${delay}"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

upload_tree() {
  local directory="$1"
  local content_type="$2"
  local exclude_prefix="${3:-}"
  local pending
  pending="$(mktemp)"
  comm -23 \
    <(
      find "${directory}" -type f -print |
        sed "s#^${RELEASE_DIR}/##" |
        awk -v exclude_prefix="${exclude_prefix}" \
          'exclude_prefix == "" || index($0, exclude_prefix) != 1' |
        LC_ALL=C sort
    ) \
    <(LC_ALL=C sort -u "${STATE_FILE}") >"${pending}"

  if [[ ! -s "${pending}" ]]; then
    rm -f "${pending}"
    return
  fi

  export RELEASE_DIR PREFIX BUCKET MAX_UPLOAD_ATTEMPTS RETRY_BASE_SECONDS
  export content_type STATE_PARTS_DIR
  export -f upload_object
  if ! xargs -0 -P "${UPLOAD_CONCURRENCY}" -n 1 bash -c '
    relative="$1"
    if upload_object \
      "${RELEASE_DIR}/${relative}" \
      "${PREFIX}/${relative}" \
      "${content_type}"; then
      printf "%s\n" "${relative}" >"${STATE_PARTS_DIR}/$$"
    else
      exit 1
    fi
  ' _ < <(awk '{ printf "%s%c", $0, 0 }' "${pending}"); then
    find "${STATE_PARTS_DIR}" -type f -exec cat {} + >>"${STATE_FILE}"
    rm -rf "${STATE_PARTS_DIR}"
    mkdir -p "${STATE_PARTS_DIR}"
    rm -f "${pending}"
    return 1
  fi

  find "${STATE_PARTS_DIR}" -type f -exec cat {} + >>"${STATE_FILE}"
  rm -rf "${STATE_PARTS_DIR}"
  mkdir -p "${STATE_PARTS_DIR}"
  rm -f "${pending}"
}

echo "Publishing terrain artifacts to r2://${BUCKET}/${PREFIX}"
echo "Temporarily excluding ${EXCLUDED_TILE_PREFIX}* from upload and completeness checks"

upload_tree "${RELEASE_DIR}/tiles" "image/webp" "${EXCLUDED_TILE_PREFIX}"
upload_tree "${RELEASE_DIR}/elevation-grids" "application/json"

if [[ -d "${RELEASE_DIR}/terrain-summaries" ]]; then
  upload_tree "${RELEASE_DIR}/terrain-summaries" "application/json"
fi

if [[ -d "${RELEASE_DIR}/provenance" ]]; then
  upload_tree "${RELEASE_DIR}/provenance" "application/json"
fi

EXPECTED_LIST="$(mktemp)"
UPLOADED_LIST="$(mktemp)"
trap 'rm -f "${EXPECTED_LIST}" "${UPLOADED_LIST}" "${EXPECTED_LIST}.filtered"; rm -rf "${STATE_PARTS_DIR}"' EXIT

{
  find "${RELEASE_DIR}/tiles" "${RELEASE_DIR}/elevation-grids" -type f -print
  [[ ! -d "${RELEASE_DIR}/terrain-summaries" ]] ||
    find "${RELEASE_DIR}/terrain-summaries" -type f -print
  [[ ! -d "${RELEASE_DIR}/provenance" ]] ||
    find "${RELEASE_DIR}/provenance" -type f -print
} | sed "s#^${RELEASE_DIR}/##" | LC_ALL=C sort -u >"${EXPECTED_LIST}"
awk -v exclude_prefix="${EXCLUDED_TILE_PREFIX}" \
  'index($0, exclude_prefix) != 1' \
  "${EXPECTED_LIST}" >"${EXPECTED_LIST}.filtered"
mv "${EXPECTED_LIST}.filtered" "${EXPECTED_LIST}"
LC_ALL=C sort -u "${STATE_FILE}" |
  awk -v exclude_prefix="${EXCLUDED_TILE_PREFIX}" \
    'index($0, exclude_prefix) != 1' >"${UPLOADED_LIST}"

if ! cmp -s "${EXPECTED_LIST}" "${UPLOADED_LIST}"; then
  missing_count="$(comm -23 "${EXPECTED_LIST}" "${UPLOADED_LIST}" | wc -l | tr -d ' ')"
  echo "Refusing to activate incomplete release: ${missing_count} artifacts are not recorded as uploaded" >&2
  exit 1
fi

echo "Published ${RELEASE_DIR} to r2://${BUCKET}/${PREFIX}"
echo "Resume state: ${STATE_FILE}"
