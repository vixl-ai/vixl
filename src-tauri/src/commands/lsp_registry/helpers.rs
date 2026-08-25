use super::types::{BuiltinLspSpec, LspTier};

fn marker_name_matches(pattern: &str, file_name: &str) -> bool {
    if !pattern.contains('*') {
        return pattern == file_name;
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 2 {
        let (prefix, suffix) = (parts[0], parts[1]);
        return file_name.starts_with(prefix)
            && file_name.ends_with(suffix)
            && file_name.len() >= prefix.len() + suffix.len();
    }
    false
}

/// Lower is better. Used to break ties when multiple servers claim the same extension.
///
/// Specialized project markers (e.g. `deno.json`) outrank generic ones (`package.json`)
/// so Deno projects do not get the TypeScript server and vice versa.
pub fn root_marker_score(workspace_root: Option<&std::path::Path>, spec: &BuiltinLspSpec) -> i32 {
    let Some(root) = workspace_root else {
        return if spec.root_markers.is_empty() {
            100
        } else {
            500
        };
    };
    if spec.root_markers.is_empty() {
        return 100;
    }
    let mut best: Option<i32> = None;
    for marker in spec.root_markers {
        let matched = if marker.contains('*') {
            std::fs::read_dir(root)
                .ok()
                .map(|entries| {
                    entries.flatten().any(|entry| {
                        entry
                            .file_name()
                            .to_str()
                            .map(|name| marker_name_matches(marker, name))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        } else {
            root.join(marker).exists()
        };
        if !matched {
            continue;
        }
        let specificity = match *marker {
            "package.json" => 50,
            _ => 0,
        };
        best = Some(best.map_or(specificity, |current| current.min(specificity)));
    }
    best.unwrap_or(1000)
}

pub fn tier_rank(tier: LspTier) -> i32 {
    match tier {
        LspTier::A => 0,
        LspTier::B => 1,
        LspTier::C => 2,
        LspTier::D => 3,
    }
}

pub fn allowlisted_lsp_basenames() -> &'static [&'static str] {
    &[
        "typescript-language-server",
        "vue-language-server",
        "vscode-json-language-server",
        "vscode-html-language-server",
        "vscode-css-language-server",
        "yaml-language-server",
        "marksman",
        "basedpyright-langserver",
        "basedpyright",
        "rust-analyzer",
        "gopls",
        "bash-language-server",
        "tailwindcss-language-server",
        "svelteserver",
        "astro-ls",
        "prisma-language-server",
        "graphql-lsp",
        "docker-langserver",
        "lua-language-server",
        "clangd",
        "terraform-ls",
        "taplo",
        "zls",
        "intelephense",
        "kotlin-language-server",
        "lemminx",
        "sql-language-server",
        "deno",
        "ruby-lsp",
        "jdtls",
        "csharp-ls",
        "omnisharp",
        "sourcekit-lsp",
        "elixir-ls",
        "haskell-language-server-wrapper",
        "clojure-lsp",
        "ocamllsp",
        "dart",
        "gleam",
        "nil",
        "nixd",
        "R",
        "metals",
        "node",
    ]
}
