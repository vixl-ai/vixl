#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LspInstallKind {
    Npm,
    GithubRelease,
    /// Direct URL archive (tar.gz / zip / tar.xz). Used when GitHub Releases are not available.
    HttpArchive,
    /// `go install <package>` into the managed server dir (requires Go on PATH).
    GoInstall,
    ToolchainPath,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LspTier {
    A,
    B,
    C,
    D,
}

#[derive(Debug, Clone)]
pub struct NpmInstallSpec {
    pub packages: &'static [&'static str],
    /// Relative path from the managed install dir to the CLI entry (node script or bin name).
    pub bin: &'static str,
    /// When true, spawn the bin as a native executable (do not wrap with `node`).
    pub native: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum GithubTargetStyle {
    /// Rust host triple, e.g. aarch64-apple-darwin
    RustTriple,
    /// Node-style, e.g. darwin-arm64
    NodeStyle,
    /// Marksman release names: macos, linux-x64, linux-arm64, or plain .exe
    Marksman,
    /// clangd release names: mac, linux, windows
    ClangdOs,
    /// zls 0.13-style: aarch64-macos, x86_64-linux, x86_64-windows
    ZigOsArch,
    /// taplo-style: darwin-aarch64, linux-x86_64, windows-x86_64
    TaploOsArch,
    /// clojure-lsp native: macos-aarch64, linux-amd64, windows-amd64
    ClojureNative,
    /// lemminx: osx-aarch_64, osx-x86_64, linux, win32
    LemminxOs,
    /// HashiCorp / Go style: darwin_arm64, linux_amd64, windows_amd64
    HashicorpOsArch,
}

#[derive(Debug, Clone)]
pub struct GithubReleaseSpec {
    pub repo: &'static str,
    pub tag: &'static str,
    /// Asset name template with `{target}` / `{version}` placeholders.
    pub asset: &'static str,
    pub binary_name: &'static str,
    pub gzip: bool,
    pub target_style: GithubTargetStyle,
}

#[derive(Debug, Clone)]
pub struct HttpArchiveSpec {
    /// URL template. May include `{version}` and `{target}` when `target_style` is set.
    pub url: &'static str,
    /// Relative path or basename to locate after extract (searched recursively if needed).
    pub binary_name: &'static str,
    /// Version key for the managed install directory (also substitutes `{version}` in url).
    pub version_key: &'static str,
    /// When set, `{target}` in `url` is replaced via `github_target_token`.
    pub target_style: Option<GithubTargetStyle>,
}

#[derive(Debug, Clone)]
pub struct GoInstallSpec {
    /// Package argument for `go install`, e.g. `golang.org/x/tools/gopls@v0.18.1`.
    pub package: &'static str,
    pub binary_name: &'static str,
    pub version_key: &'static str,
}

#[derive(Debug, Clone)]
pub struct BuiltinLspSpec {
    pub id: &'static str,
    pub command: &'static [&'static str],
    pub extensions: &'static [&'static str],
    pub language_ids: &'static [&'static str],
    pub tier: LspTier,
    pub install: LspInstallKind,
    pub npm: Option<NpmInstallSpec>,
    pub github: Option<GithubReleaseSpec>,
    pub http: Option<HttpArchiveSpec>,
    pub go: Option<GoInstallSpec>,
    pub root_markers: &'static [&'static str],
    pub requires_trust: bool,
}
