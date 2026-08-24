#!/usr/bin/env bash
# Stage CEF binaries for Tauri bundling (macOS / Linux).
# Requires CEF_PATH (or ~/.local/share/cef from export-cef-dir).
# Builds vixl_cef_helper: Linux/Windows use bundle.externalBin; macOS
# stages nested Helper.app trees under src-tauri/cef-helpers/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_TAURI="$ROOT/src-tauri"
CEF_PATH="${CEF_PATH:-${HOME}/.local/share/cef}"
DEST="$SRC_TAURI/cef-runtime"
BINARIES="$SRC_TAURI/binaries"
HELPERS_DEST="$SRC_TAURI/cef-helpers"
PROFILE="${CEF_BUNDLE_PROFILE:-release}"

if [[ ! -d "$CEF_PATH" ]]; then
  echo "CEF_PATH not found: $CEF_PATH" >&2
  echo "Install with: cargo install export-cef-dir && export-cef-dir --force \"\$HOME/.local/share/cef\"" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST" "$BINARIES"

OS="$(uname -s)"
case "$OS" in
  Darwin)
    FRAMEWORK="$CEF_PATH/Chromium Embedded Framework.framework"
    if [[ ! -d "$FRAMEWORK" ]]; then
      echo "Missing framework at $FRAMEWORK" >&2
      exit 1
    fi
    # ditto preserves symlinks (required for codesign of nested frameworks)
    ditto "$FRAMEWORK" "$DEST/Chromium Embedded Framework.framework"
    ;;
  Linux)
    # Flat CEF layout: shared libs + locales + pak/dat next to the binary.
    if command -v rsync >/dev/null 2>&1; then
      rsync -a \
        --exclude='include' \
        --exclude='cmake' \
        --exclude='libcef_dll' \
        --exclude='CMakeLists.txt' \
        --exclude='*.a' \
        "$CEF_PATH/" "$DEST/"
    else
      cp -a "$CEF_PATH"/. "$DEST/"
      rm -rf "$DEST/include" "$DEST/cmake" "$DEST/libcef_dll" "$DEST/CMakeLists.txt"
    fi
    ;;
  *)
    echo "Unsupported OS for this script: $OS (use scripts/prepare-cef-bundle.ps1 on Windows)" >&2
    exit 1
    ;;
esac

TARGET_TRIPLE="${CARGO_BUILD_TARGET:-$(rustc -vV | awk '/^host:/{print $2}')}"
FEATURES=(--features cef --bin vixl_cef_helper --manifest-path "$SRC_TAURI/Cargo.toml")
BUILD_ARGS=()
if [[ -n "${CARGO_BUILD_TARGET:-}" ]]; then
  BUILD_ARGS+=(--target "$CARGO_BUILD_TARGET")
fi
BUILD_ARGS+=("${FEATURES[@]}")
if [[ "$PROFILE" == "release" ]]; then
  cargo build --release "${BUILD_ARGS[@]}"
  if [[ -n "${CARGO_BUILD_TARGET:-}" ]]; then
    HELPER_SRC="$SRC_TAURI/target/${CARGO_BUILD_TARGET}/release/vixl_cef_helper"
  else
    HELPER_SRC="$SRC_TAURI/target/release/vixl_cef_helper"
  fi
else
  cargo build "${BUILD_ARGS[@]}"
  if [[ -n "${CARGO_BUILD_TARGET:-}" ]]; then
    HELPER_SRC="$SRC_TAURI/target/${CARGO_BUILD_TARGET}/debug/vixl_cef_helper"
  else
    HELPER_SRC="$SRC_TAURI/target/debug/vixl_cef_helper"
  fi
fi

if [[ ! -f "$HELPER_SRC" ]]; then
  echo "Helper binary missing at $HELPER_SRC" >&2
  exit 1
fi

cp "$HELPER_SRC" "$BINARIES/vixl_cef_helper-${TARGET_TRIPLE}"
chmod +x "$BINARIES/vixl_cef_helper-${TARGET_TRIPLE}"

if [[ "$OS" == "Darwin" ]]; then
  rm -rf "$HELPERS_DEST"
  mkdir -p "$HELPERS_DEST"
  stage_macos_helper_app() {
    local app_file_name="$1"
    local bundle_id="$2"
    local exe_name="$3"
    local app_dir="$HELPERS_DEST/$app_file_name"
    local macos_dir="$app_dir/Contents/MacOS"
    mkdir -p "$macos_dir"
    # Chromium helper Info.plist: LSBackgroundOnly plus LSUIElement so
    # Launch Services / Spotlight / Raycast do not list these as apps.
    cat > "$app_dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${exe_name}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundle_id}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${exe_name}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>LSFileQuarantineEnabled</key>
  <true/>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
</dict>
</plist>
PLIST
    cp "$HELPER_SRC" "$macos_dir/$exe_name"
    chmod +x "$macos_dir/$exe_name"
    codesign --force --sign - "$macos_dir/$exe_name"
    codesign --force --sign - "$app_dir"
  }
  stage_macos_helper_app "vixl Helper.app" "app.vixl.helper" "vixl Helper"
  stage_macos_helper_app "vixl Helper (GPU).app" "app.vixl.helper.gpu" "vixl Helper (GPU)"
  stage_macos_helper_app "vixl Helper (Plugin).app" "app.vixl.helper.plugin" "vixl Helper (Plugin)"
  stage_macos_helper_app "vixl Helper (Renderer).app" "app.vixl.helper.renderer" "vixl Helper (Renderer)"
  stage_macos_helper_app "vixl Helper (Alerts).app" "app.vixl.helper.alerts" "vixl Helper (Alerts)"
  echo "Staged nested helper apps at $HELPERS_DEST"
fi

echo "Staged CEF runtime at $DEST"
echo "Staged helper as $BINARIES/vixl_cef_helper-${TARGET_TRIPLE}"
echo "Use: npm run tauri build -- --features cef --config src-tauri/tauri.cef.macos.conf.json"
# (Linux / Windows overlays: src-tauri/tauri.cef.linux.conf.json / tauri.cef.windows.conf.json)
