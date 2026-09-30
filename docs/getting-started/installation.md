---
title: Installation
description: Install the Vixl desktop app from GitHub Releases for macOS arm64, Linux x64, and Windows, or build from source.
---

# Installation

Prebuilt installers come from [GitHub Releases](https://github.com/vixl-ai/vixl/releases). The [Release](https://github.com/vixl-ai/vixl/blob/main/.github/workflows/release.yml) workflow publishes:

- macOS arm64 (Apple Silicon): `.dmg` and `.app.tar.gz`
- Linux x64: AppImage, `.deb`, and `.rpm`
- Windows: NSIS installer

There is no prebuilt Intel Mac or Linux arm64 installer. Use [build from source](#build-from-source) on those machines.

The desktop shell is [Tauri](https://tauri.app/). After install, the app can check `https://github.com/vixl-ai/vixl/releases/latest/download/latest.json` for updates from Settings, General.

## Install a release

1. Download the installer for your OS from [GitHub Releases](https://github.com/vixl-ai/vixl/releases), plus `SHA256SUMS.txt` from the same tag (`SHA512SUMS.txt` is attached too).
2. Verify the files in the download directory.

```bash
# macOS
shasum -a 256 -c SHA256SUMS.txt

# Linux (Git Bash on Windows can run this too)
sha256sum -c SHA256SUMS.txt
```

Only trust checksum files from that GitHub Release tag.

3. Install the bundle and open Vixl.

First launch lands on the home [chat input](/getting-started/your-first-chat).

::: warning Unsigned installers
macOS builds are not signed with a Developer ID and are not notarized. Gatekeeper will block the first open. Right-click the app, choose Open, then Open again. If macOS still refuses, open System Settings, Privacy & Security, and choose Open Anyway.

The Windows NSIS installer is not Authenticode-signed. SmartScreen may show Windows protected your PC. Choose More info, then Run anyway.

Those OS checks are separate from the updater minisign signature, which only verifies in-app updates.
:::

## Build from source

Use the [Node.js](https://nodejs.org/) version in [`.nvmrc`](https://github.com/vixl-ai/vixl/blob/main/.nvmrc) (currently 26.7.0), install modules, and boot the desktop app.

1. Clone the repo.

```bash
git clone https://github.com/vixl-ai/vixl.git
cd vixl
```

2. Use the Node version in `.nvmrc`.
3. Install the [Rust](https://www.rust-lang.org/) toolchain from [rustup.rs](https://rustup.rs/).
4. Install modules with `npm ci`.
5. Boot the desktop app with `npm run tauri -- dev`.

`npm run dev` starts the [Vite](https://vite.dev/) frontend only. Use the Tauri command for the desktop app.

Dev setup and how maintainers cut a release are in [CONTRIBUTING.md](https://github.com/vixl-ai/vixl/blob/main/CONTRIBUTING.md).

Next, [set up providers and models](/getting-started/set-up-providers-and-models).
