use super::super::lsp_registry::{GithubReleaseSpec, GithubTargetStyle, HttpArchiveSpec};

pub fn host_asset_target() -> String {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match (os, arch) {
        ("macos", "aarch64") => "aarch64-apple-darwin".to_string(),
        ("macos", "x86_64") => "x86_64-apple-darwin".to_string(),
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu".to_string(),
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu".to_string(),
        ("windows", "x86_64") => "x86_64-pc-windows-msvc".to_string(),
        ("windows", "aarch64") => "aarch64-pc-windows-msvc".to_string(),
        _ => format!("{arch}-{os}"),
    }
}

pub(crate) fn github_target_token(style: GithubTargetStyle) -> Result<String, String> {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match style {
        GithubTargetStyle::RustTriple => Ok(host_asset_target()),
        GithubTargetStyle::NodeStyle => Ok(match (os, arch) {
            ("macos", "aarch64") => "darwin-arm64".to_string(),
            ("macos", "x86_64") => "darwin-x64".to_string(),
            ("linux", "aarch64") => "linux-arm64".to_string(),
            ("linux", "x86_64") => "linux-x64".to_string(),
            ("windows", "x86_64") => "win32-x64".to_string(),
            ("windows", "aarch64") => "win32-arm64".to_string(),
            _ => {
                return Err(format!(
                    "Unsupported platform for Node-style assets: {os}/{arch}"
                ))
            }
        }),
        GithubTargetStyle::Marksman => Ok(match (os, arch) {
            // Universal macOS binary in marksman releases.
            ("macos", _) => "macos".to_string(),
            ("linux", "aarch64") => "linux-arm64".to_string(),
            ("linux", "x86_64") => "linux-x64".to_string(),
            // Windows asset is literally marksman.exe (no target suffix).
            ("windows", _) => "exe".to_string(),
            _ => return Err(format!("Unsupported platform for marksman: {os}/{arch}")),
        }),
        GithubTargetStyle::ClangdOs => Ok(match os {
            "macos" => "mac".to_string(),
            "linux" => "linux".to_string(),
            "windows" => "windows".to_string(),
            _ => return Err(format!("Unsupported platform for clangd: {os}/{arch}")),
        }),
        GithubTargetStyle::ZigOsArch => Ok(match (os, arch) {
            ("macos", "aarch64") => "aarch64-macos".to_string(),
            ("macos", "x86_64") => "x86_64-macos".to_string(),
            ("linux", "aarch64") => "aarch64-linux".to_string(),
            ("linux", "x86_64") => "x86_64-linux".to_string(),
            ("windows", "x86_64") => "x86_64-windows".to_string(),
            ("windows", "x86") => "x86-windows".to_string(),
            _ => return Err(format!("Unsupported platform for zls: {os}/{arch}")),
        }),
        GithubTargetStyle::TaploOsArch => Ok(match (os, arch) {
            ("macos", "aarch64") => "darwin-aarch64".to_string(),
            ("macos", "x86_64") => "darwin-x86_64".to_string(),
            ("linux", "aarch64") => "linux-aarch64".to_string(),
            ("linux", "x86_64") => "linux-x86_64".to_string(),
            ("windows", "x86_64") => "windows-x86_64".to_string(),
            ("windows", "x86") => "windows-x86".to_string(),
            _ => return Err(format!("Unsupported platform for taplo: {os}/{arch}")),
        }),
        GithubTargetStyle::ClojureNative => Ok(match (os, arch) {
            ("macos", "aarch64") => "macos-aarch64".to_string(),
            ("macos", "x86_64") => "macos-amd64".to_string(),
            ("linux", "aarch64") => "linux-aarch64".to_string(),
            ("linux", "x86_64") => "linux-amd64".to_string(),
            ("windows", "x86_64") => "windows-amd64".to_string(),
            _ => return Err(format!("Unsupported platform for clojure-lsp: {os}/{arch}")),
        }),
        GithubTargetStyle::LemminxOs => Ok(match (os, arch) {
            ("macos", "aarch64") => "osx-aarch_64".to_string(),
            ("macos", "x86_64") => "osx-x86_64".to_string(),
            ("linux", _) => "linux".to_string(),
            ("windows", _) => "win32".to_string(),
            _ => return Err(format!("Unsupported platform for lemminx: {os}/{arch}")),
        }),
        GithubTargetStyle::HashicorpOsArch => Ok(match (os, arch) {
            ("macos", "aarch64") => "darwin_arm64".to_string(),
            ("macos", "x86_64") => "darwin_amd64".to_string(),
            ("linux", "aarch64") => "linux_arm64".to_string(),
            ("linux", "x86_64") => "linux_amd64".to_string(),
            ("windows", "x86_64") => "windows_amd64".to_string(),
            ("windows", "aarch64") => "windows_arm64".to_string(),
            _ => {
                return Err(format!(
                    "Unsupported platform for HashiCorp assets: {os}/{arch}"
                ))
            }
        }),
    }
}

pub(crate) fn resolve_http_archive_url(spec: &HttpArchiveSpec) -> Result<String, String> {
    let mut url = spec.url.replace("{version}", spec.version_key);
    if let Some(style) = spec.target_style {
        let target = github_target_token(style)?;
        url = url.replace("{target}", &target);
    }
    Ok(url)
}

pub(crate) fn resolve_github_asset(spec: &GithubReleaseSpec) -> Result<(String, String), String> {
    let target = github_target_token(spec.target_style)?;
    let mut asset = spec.asset.replace("{target}", &target);
    asset = asset.replace("{version}", spec.tag.trim_start_matches('v'));

    // Marksman Windows release is `marksman.exe`, not `marksman-exe`.
    if spec.target_style == GithubTargetStyle::Marksman && target == "exe" {
        asset = "marksman.exe".to_string();
    }

    // zls Windows assets are zip, not tar.xz.
    if spec.target_style == GithubTargetStyle::ZigOsArch && std::env::consts::OS == "windows" {
        asset = asset.replace(".tar.xz", ".zip");
    }

    // lua-language-server Windows assets are zip, not tar.gz.
    if spec.target_style == GithubTargetStyle::NodeStyle && std::env::consts::OS == "windows" {
        asset = asset.replace(".tar.gz", ".zip");
    }

    let url = format!(
        "https://github.com/{}/releases/download/{}/{}",
        spec.repo, spec.tag, asset
    );
    Ok((url, asset))
}
