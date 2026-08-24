# Stage CEF binaries for Tauri bundling on Windows.
# Requires $env:CEF_PATH (or $env:USERPROFILE\.local\share\cef).
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$SrcTauri = Join-Path $Root "src-tauri"
$CefPath = if ($env:CEF_PATH) { $env:CEF_PATH } else { Join-Path $env:USERPROFILE ".local\share\cef" }
$Dest = Join-Path $SrcTauri "cef-runtime"
$Binaries = Join-Path $SrcTauri "binaries"
$Profile = if ($env:CEF_BUNDLE_PROFILE) { $env:CEF_BUNDLE_PROFILE } else { "release" }

if (-not (Test-Path $CefPath)) {
  Write-Error "CEF_PATH not found: $CefPath. Install with export-cef-dir."
}

if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
New-Item -ItemType Directory -Force -Path $Binaries | Out-Null

Get-ChildItem -Path $CefPath -Force | Where-Object {
  $_.Name -notin @("include", "cmake", "libcef_dll", "CMakeLists.txt")
} | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $Dest -Recurse -Force
}

$TargetTriple = (rustc -vV | Select-String "^host:").ToString().Split(" ")[1]
$Manifest = Join-Path $SrcTauri "Cargo.toml"
if ($Profile -eq "release") {
  cargo build --release --features cef --bin vixl_cef_helper --manifest-path $Manifest
  $HelperSrc = Join-Path $SrcTauri "target\release\vixl_cef_helper.exe"
} else {
  cargo build --features cef --bin vixl_cef_helper --manifest-path $Manifest
  $HelperSrc = Join-Path $SrcTauri "target\debug\vixl_cef_helper.exe"
}

if (-not (Test-Path $HelperSrc)) {
  Write-Error "Helper binary missing at $HelperSrc"
}

$HelperDest = Join-Path $Binaries "vixl_cef_helper-$TargetTriple.exe"
Copy-Item -Path $HelperSrc -Destination $HelperDest -Force

Write-Host "Staged CEF runtime at $Dest"
Write-Host "Staged helper as $HelperDest"
Write-Host "Use: npm run tauri build -- --features cef --config src-tauri/tauri.cef.windows.conf.json"
