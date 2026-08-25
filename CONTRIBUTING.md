# Contributing to vixl

Thank you for your interest in contributing! This document explains how to get
involved. By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Where GitHub looks for these files

GitHub's [community profile](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)
checks the **repository root** for:

| File | Purpose |
| --- | --- |
| `CONTRIBUTING.md` | How to contribute (this file) |
| `CODE_OF_CONDUCT.md` | Community standards |

Optional but recommended in `.github/`: issue templates, pull request template,
and `SECURITY.md` for security reports.

## Ways to contribute

- **Bug reports**: open an issue with reproduction steps, OS, and relevant provider/MCP setup.
- **Feature requests**: open an issue describing the use case before large PRs.
- **Documentation**: fixes and clarifications in `README.md` and `docs/`.
- **Code**: bug fixes, tests, and features via pull request.

## Development setup

Requirements: **Node.js** matching `.nvmrc` (currently 26.7.0; CI reads the same file), **npm**, and a Rust toolchain for the Tauri shell.

```bash
git clone https://github.com/vixl-ai/vixl.git
cd vixl
npm ci
```

### App

```bash
# Vite frontend
npm run dev

# Tauri desktop shell
npm run tauri:dev
```

### Quality checks

Run these before opening a PR:

| Command | What it does |
| --- | --- |
| `npm run ci` | lint, type-check, `test:coverage`, npm audit, build |
| `npm run audit:rust` | cargo audit on `src-tauri/Cargo.lock` |
| `npm run test:unit` | Vitest (when touching covered code) |

CI also runs a Tauri build job. Match existing style and the conventions in `AGENTS.md`.

### Docs site

The docs site is VuePress (`docs/`).

```bash
npm run docs:dev
npm run docs:build
```

## Pull request process

1. Fork the repo and create a branch from `main`.
2. Make focused changes; avoid unrelated drive-by edits.
3. Add or update tests when changing harness, tools, or other covered behaviour.
4. Update `docs/` or `README.md` when behaviour or public surfaces change.
5. Ensure `npm run ci` passes (and Rust audit when you touch `src-tauri`).
6. Open a PR against `main` and fill out the [PR template](.github/pull_request_template.md).
7. Wait for required checks (`CI`, `Rust audit`, `Tauri build`) and a [CODEOWNERS](.github/CODEOWNERS) review.
8. Ensure every commit is **signed and verified** (GPG or SSH). Unsigned commits cannot land on `main`.

Direct pushes to `main` are blocked for everyone except maintainers with ruleset bypass for PR/CI rules. **Signed commits are required for everyone**, including maintainers. See [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification).

### Signing commits (SSH)

```bash
# Add your public key as a signing key at:
# https://github.com/settings/keys  (SSH signing keys)

git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
ssh-add ~/.ssh/id_ed25519   # unlock once per session if the key is passphrase-protected
```

Breaking changes should be called out in the PR description.

## Project layout

| Path | Description |
| --- | --- |
| `src/` | Vue app (views, components, composables, services) |
| `src/services/harness/` | Agent harness and tool loop |
| `src-tauri/` | Tauri / Rust shell |
| `src/prompts/` | System and tool guidance prompts |
| `docs/` | VuePress documentation |
| `docs/media/` | README screenshots and assets |

## Commit messages

Use clear, imperative subject lines (e.g. `fix: clear MCP trust on fingerprint change`).
Conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`) are welcome but not
required.

## Releases

Maintainers handle releases. Contributors do not need to publish builds.

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` so they match.
2. Merge the version bump to `main` (signed commits, CI green, review as usual).
3. Tag and push, or run the **Release** workflow manually:

```bash
git tag v0.1.0-alpha.0
git push origin v0.1.0-alpha.0
```

The [Release](.github/workflows/release.yml) workflow builds macOS (arm64 + x64), Linux x64, and Windows via [`tauri-action`](https://v2.tauri.app/distribute/pipelines/github/), uploads installers to a GitHub Release, then attaches `SHA256SUMS.txt` and `SHA512SUMS.txt` and publishes the release.

Do not inject empty `APPLE_*` secrets: GitHub passes empty strings and macOS bundling fails on `security import`. When a real Developer ID certificate exists, add these env vars to the tauri-action step only if every value is non-empty: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.

### OTA updates

The Release workflow signs updater artifacts and uploads a static `latest.json` to each GitHub Release (via tauri-action defaults). The app's updater checks `https://github.com/vixl-ai/vixl/releases/download/v{{current_version}}/latest.json` (Tauri substitutes the running app version).

Required repo secret for OTA: `TAURI_SIGNING_PRIVATE_KEY` (minisign key, passwordless). Optional: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if a password-protected key is used.

**Critical:** the private key is permanent. If lost, already-installed clients cannot update to new versions without shipping a new build that embeds a new pubkey. Store the private key offline and back it up.

The public key is embedded in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

Apple notarization (`APPLE_*` secrets) is separate from the updater minisign signature: one is for Gatekeeper trust, the other is for OTA integrity.

GitHub `/releases/latest` only resolves the latest non-prerelease, non-draft release. Current Release workflow tags are prereleases (`prerelease: true`), so `/releases/latest/download/latest.json` 404s. Keep using the versioned `/releases/download/v{{current_version}}/latest.json` URL while shipping prereleases. Releases must still be published (not draft) so the asset URL resolves. The checksums job already flips draft to false after all matrix legs, so clients never see a partial `latest.json`.

### Verify a download

```bash
# Download the installer(s) plus SHA256SUMS.txt from the GitHub Release, then:
sha256sum -c SHA256SUMS.txt
# or on macOS:
shasum -a 256 -c SHA256SUMS.txt
```

Only trust checksum files from the matching GitHub Release tag.

## Questions

Open a GitHub issue. For conduct concerns, see
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
