#!/usr/bin/env bash
# Single writer for a GitHub Release: upload every platform bundle, write
# latest.json once, checksum, then publish. Matrix build jobs must not
# create or update the release.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${TAG:?TAG is required}"
: "${VERSION:?VERSION is required}"
: "${ASSET_DIR:?ASSET_DIR is required}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"
if ! git show-ref --verify --quiet "refs/tags/${TAG}"; then
  git fetch --force origin "refs/tags/${TAG}:refs/tags/${TAG}"
fi
STAGING="$(mktemp -d)"
NOTES_FILE="$(mktemp)"
ASSETS_JSON="$(mktemp)"
LATEST="${STAGING}/latest.json"
API_BASE="https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/assets"

cleanup() {
  rm -rf "${STAGING}"
  rm -f "${NOTES_FILE}" "${ASSETS_JSON}"
}
trap cleanup EXIT

if [[ ! -d "${ASSET_DIR}" ]]; then
  echo "ASSET_DIR does not exist: ${ASSET_DIR}" >&2
  exit 1
fi

is_release_bundle() {
  local name="$1"
  case "${name}" in
    *.app.tar.gz.sig|*.app.tar.gz|*.dmg|*.AppImage.tar.gz.sig|*.AppImage.tar.gz|*.AppImage.sig|*.AppImage|*.deb.sig|*.deb|*.rpm.sig|*.rpm|*.nsis.zip.sig|*.nsis.zip|*-setup.exe.sig|*-setup.exe)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

while IFS= read -r -d '' src; do
  name="$(basename "${src}")"
  if ! is_release_bundle "${name}"; then
    continue
  fi
  dest="${STAGING}/${name}"
  if [[ -e "${dest}" ]]; then
    if ! cmp -s "${src}" "${dest}"; then
      echo "Conflicting contents for ${name}" >&2
      exit 1
    fi
    continue
  fi
  cp -a "${src}" "${dest}"
done < <(find "${ASSET_DIR}" -type f -print0)

# tauri writes macos/vixl.app.tar.gz; GitHub Releases use the versioned name.
if [[ -f "${STAGING}/vixl.app.tar.gz" ]]; then
  mv "${STAGING}/vixl.app.tar.gz" "${STAGING}/vixl_${VERSION}_aarch64.app.tar.gz"
fi
if [[ -f "${STAGING}/vixl.app.tar.gz.sig" ]]; then
  mv "${STAGING}/vixl.app.tar.gz.sig" "${STAGING}/vixl_${VERSION}_aarch64.app.tar.gz.sig"
fi

echo "Staged release files:"
ls -la "${STAGING}"

find_one() {
  local pattern="$1"
  local label="$2"
  local matches=()
  local f
  shopt -s nullglob
  matches=("${STAGING}"/${pattern})
  shopt -u nullglob
  if [[ ${#matches[@]} -ne 1 ]]; then
    echo "Expected exactly one ${label} (${pattern}), found ${#matches[@]}" >&2
    ls -la "${STAGING}" >&2
    exit 1
  fi
  f="${matches[0]}"
  if [[ ! -s "${f}" ]]; then
    echo "Required file is empty: ${f}" >&2
    exit 1
  fi
  printf '%s\n' "${f}"
}

APP_TAR="$(find_one "vixl_${VERSION}_aarch64.app.tar.gz" 'macOS updater archive')"
APP_TAR_SIG="$(find_one "vixl_${VERSION}_aarch64.app.tar.gz.sig" 'macOS updater signature')"
DMG="$(find_one "vixl_${VERSION}_aarch64.dmg" 'macOS dmg')"
APPIMAGE="$(find_one "vixl_${VERSION}_amd64.AppImage" 'Linux AppImage')"
APPIMAGE_SIG="$(find_one "vixl_${VERSION}_amd64.AppImage.sig" 'Linux AppImage signature')"
DEB="$(find_one "vixl_${VERSION}_amd64.deb" 'Linux deb')"
DEB_SIG="$(find_one "vixl_${VERSION}_amd64.deb.sig" 'Linux deb signature')"
RPM="$(find_one "vixl-${VERSION}-1.x86_64.rpm" 'Linux rpm')"
RPM_SIG="$(find_one "vixl-${VERSION}-1.x86_64.rpm.sig" 'Linux rpm signature')"
NSIS="$(find_one "vixl_${VERSION}_x64-setup.exe" 'Windows NSIS installer')"
NSIS_SIG="$(find_one "vixl_${VERSION}_x64-setup.exe.sig" 'Windows NSIS signature')"

mapfile -t UPLOAD_FILES < <(find "${STAGING}" -maxdepth 1 -type f ! -name 'latest.json' | sed 's|^\./||' | sort)
if [[ ${#UPLOAD_FILES[@]} -eq 0 ]]; then
  echo "No bundle files to upload" >&2
  exit 1
fi

{
  echo "vixl v${VERSION}"
  echo
  echo "Installers and bundles for macOS, Linux, and Windows are attached below."
  echo
  echo "Checksums (\`SHA256SUMS.txt\`, \`SHA512SUMS.txt\`) are attached after all platform builds finish."
  echo "See CONTRIBUTING.md for how to verify downloads."
} > "${NOTES_FILE}"

gh release create "${TAG}" \
  --repo "${GITHUB_REPOSITORY}" \
  --draft \
  --verify-tag \
  --title "vixl v${VERSION}" \
  --notes-file "${NOTES_FILE}"

gh release upload "${TAG}" \
  --repo "${GITHUB_REPOSITORY}" \
  -- "${UPLOAD_FILES[@]}"

gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${TAG}" > "${ASSETS_JSON}"

asset_id() {
  local name="$1"
  local id
  id="$(jq -r --arg n "${name}" '.assets[] | select(.name == $n) | .id' "${ASSETS_JSON}")"
  if [[ -z "${id}" || "${id}" == "null" ]]; then
    echo "Release is missing asset ${name}" >&2
    exit 1
  fi
  printf '%s\n' "${id}"
}

asset_url() {
  local name="$1"
  printf '%s/%s\n' "${API_BASE}" "$(asset_id "${name}")"
}

NOTES="$(cat "${NOTES_FILE}")"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

jq -n \
  --arg version "${VERSION}" \
  --arg notes "${NOTES}" \
  --arg pub_date "${PUB_DATE}" \
  '{version: $version, notes: $notes, pub_date: $pub_date, platforms: {}}' \
  > "${LATEST}"

add_platform() {
  local key="$1"
  local file="$2"
  local sig="$3"
  local url
  url="$(asset_url "$(basename "${file}")")"
  jq \
    --arg key "${key}" \
    --arg url "${url}" \
    --rawfile sig "${sig}" \
    '.platforms[$key] = {signature: ($sig | sub("\\n+$";"")), url: $url}' \
    "${LATEST}" > "${LATEST}.tmp"
  mv "${LATEST}.tmp" "${LATEST}"
}

add_platform "darwin-aarch64" "${APP_TAR}" "${APP_TAR_SIG}"
add_platform "darwin-aarch64-app" "${APP_TAR}" "${APP_TAR_SIG}"
add_platform "windows-x86_64" "${NSIS}" "${NSIS_SIG}"
add_platform "windows-x86_64-nsis" "${NSIS}" "${NSIS_SIG}"
add_platform "linux-x86_64" "${APPIMAGE}" "${APPIMAGE_SIG}"
add_platform "linux-x86_64-appimage" "${APPIMAGE}" "${APPIMAGE_SIG}"
add_platform "linux-x86_64-deb" "${DEB}" "${DEB_SIG}"
add_platform "linux-x86_64-rpm" "${RPM}" "${RPM_SIG}"

REQUIRED_KEYS=(
  darwin-aarch64
  darwin-aarch64-app
  windows-x86_64
  windows-x86_64-nsis
  linux-x86_64-appimage
)

for key in "${REQUIRED_KEYS[@]}"; do
  if ! jq -e --arg k "${key}" '
    .platforms[$k]
    and (.platforms[$k].url | type == "string" and length > 0)
    and (.platforms[$k].signature | type == "string" and length > 0)
  ' "${LATEST}" >/dev/null; then
    echo "latest.json is missing required platform ${key}" >&2
    cat "${LATEST}" >&2
    exit 1
  fi
done

for key in darwin-aarch64 darwin-aarch64-app; do
  url="$(jq -r --arg k "${key}" '.platforms[$k].url' "${LATEST}")"
  name="$(jq -r --arg id "${url##*/}" '.assets[] | select((.id | tostring) == $id) | .name' "${ASSETS_JSON}")"
  if [[ "${name}" != *_aarch64.app.tar.gz ]]; then
    echo "Platform ${key} must point at the macOS .app.tar.gz, got ${name}" >&2
    exit 1
  fi
done

gh release upload "${TAG}" \
  --repo "${GITHUB_REPOSITORY}" \
  "${LATEST}"

cd "${STAGING}"
mapfile -t CHECKSUM_FILES < <(find . -maxdepth 1 -type f ! -name 'SHA256SUMS.txt' ! -name 'SHA512SUMS.txt' | sed 's|^\./||' | sort)
sha256sum -- "${CHECKSUM_FILES[@]}" > SHA256SUMS.txt
sha512sum -- "${CHECKSUM_FILES[@]}" > SHA512SUMS.txt

{
  echo "## vixl v${VERSION}"
  echo
  echo "Installers and bundles for macOS, Linux, and Windows are attached below."
  echo
  echo "### Verify downloads"
  echo
  echo "1. Download the asset(s) you need and \`SHA256SUMS.txt\` (or \`SHA512SUMS.txt\`)."
  echo "2. From the download directory, run:"
  echo
  echo '```bash'
  echo 'sha256sum -c SHA256SUMS.txt'
  echo '# or'
  echo 'sha512sum -c SHA512SUMS.txt'
  echo '```'
  echo
  echo "On macOS you can use \`shasum -a 256 -c SHA256SUMS.txt\`."
  echo
  echo "Only trust checksum files from this GitHub Release for tag \`${TAG}\`."
  echo
  echo "### Assets"
  echo
  for f in "${CHECKSUM_FILES[@]}"; do
    echo "- \`${f}\`"
  done
} > "${NOTES_FILE}"

gh release upload "${TAG}" \
  --repo "${GITHUB_REPOSITORY}" \
  SHA256SUMS.txt \
  SHA512SUMS.txt

gh release edit "${TAG}" \
  --repo "${GITHUB_REPOSITORY}" \
  --notes-file "${NOTES_FILE}" \
  --draft=false

echo "Published ${TAG} from ${ROOT}"
