use std::collections::HashMap;

use super::types::*;

pub fn builtin_specs() -> Vec<&'static BuiltinLspSpec> {
    BUILTINS.iter().collect()
}

pub fn builtin_spec_by_id(id: &str) -> Option<&'static BuiltinLspSpec> {
    BUILTINS.iter().find(|spec| spec.id == id)
}

pub fn tier_a_ids() -> Vec<&'static str> {
    BUILTINS
        .iter()
        .filter(|spec| spec.tier == LspTier::A)
        .map(|spec| spec.id)
        .collect()
}

pub fn language_id_for_extension(extension: &str) -> String {
    let ext = extension.trim_start_matches('.');
    for spec in BUILTINS {
        for (i, configured) in spec.extensions.iter().enumerate() {
            let configured = configured.trim_start_matches('.');
            if configured.eq_ignore_ascii_case(ext) {
                if let Some(lang) = spec
                    .language_ids
                    .get(i)
                    .or_else(|| spec.language_ids.first())
                {
                    return (*lang).to_string();
                }
            }
        }
    }
    match ext {
        "ts" | "tsx" => "typescript".to_string(),
        "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" => "javascript".to_string(),
        other => other.to_string(),
    }
}

macro_rules! npm_spec {
    ($id:expr, $cmd:expr, $exts:expr, $langs:expr, $tier:expr, $pkgs:expr, $bin:expr, $markers:expr) => {
        BuiltinLspSpec {
            id: $id,
            command: $cmd,
            extensions: $exts,
            language_ids: $langs,
            tier: $tier,
            install: LspInstallKind::Npm,
            npm: Some(NpmInstallSpec {
                packages: $pkgs,
                bin: $bin,
            }),
            github: None,
            http: None,
            go: None,
            root_markers: $markers,
            requires_trust: false,
        }
    };
}

pub(crate) static BUILTINS: &[BuiltinLspSpec] = &[
  // Tier A
  npm_spec!(
    "typescript",
    &["typescript-language-server", "--stdio"],
    &[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    &["typescript", "typescriptreact", "javascript", "javascriptreact", "javascript", "javascript", "typescript", "typescript"],
    LspTier::A,
    // 4.4+ required for typescript.tsserverRequest (Vue LS 3 hybrid bridge).
    &["typescript-language-server@5.3.0", "typescript@5.8.2"],
    "node_modules/typescript-language-server/lib/cli.mjs",
    &[
      "package.json",
      "nuxt.config.ts",
      "nuxt.config.js",
      "nuxt.config.mjs",
      "nuxt.config.cjs",
      ".nuxtrc",
      ".nuxt",
    ]
  ),
  npm_spec!(
    "vue",
    &["vue-language-server", "--stdio"],
    &[".vue"],
    &["vue"],
    LspTier::A,
    &["@vue/language-server@3.3.9", "@vue/typescript-plugin@3.3.9", "typescript@5.8.2"],
    "node_modules/@vue/language-server/bin/vue-language-server.js",
    &[
      "package.json",
      "nuxt.config.ts",
      "nuxt.config.js",
      "nuxt.config.mjs",
      "nuxt.config.cjs",
      ".nuxtrc",
      ".nuxt",
    ]
  ),
  npm_spec!(
    "json",
    &["vscode-json-language-server", "--stdio"],
    &[".json", ".jsonc"],
    &["json", "jsonc"],
    LspTier::A,
    &["vscode-langservers-extracted@4.10.0"],
    "node_modules/vscode-langservers-extracted/bin/vscode-json-language-server",
    &[]
  ),
  npm_spec!(
    "yaml",
    &["yaml-language-server", "--stdio"],
    &[".yaml", ".yml"],
    &["yaml", "yaml"],
    LspTier::A,
    &["yaml-language-server@1.17.0"],
    "node_modules/yaml-language-server/bin/yaml-language-server",
    &[]
  ),
  BuiltinLspSpec {
    id: "markdown",
    command: &["marksman", "server"],
    extensions: &[".md", ".markdown"],
    language_ids: &["markdown", "markdown"],
    tier: LspTier::A,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "artempyanykh/marksman",
      tag: "2024-12-18",
      asset: "marksman-{target}",
      binary_name: "marksman",
      gzip: false,
      target_style: GithubTargetStyle::Marksman,
    }),
    http: None,
    go: None,
    root_markers: &[],
    requires_trust: false,
  },
  // Tier B
  npm_spec!(
    "python",
    &["basedpyright-langserver", "--stdio"],
    &[".py", ".pyi"],
    &["python", "python"],
    LspTier::B,
    &["basedpyright@1.28.5"],
    "node_modules/basedpyright/langserver.index.js",
    &["pyproject.toml", "requirements.txt", "setup.py"]
  ),
  BuiltinLspSpec {
    id: "rust",
    command: &["rust-analyzer"],
    extensions: &[".rs"],
    language_ids: &["rust"],
    tier: LspTier::B,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "rust-lang/rust-analyzer",
      tag: "2025-03-10",
      asset: "rust-analyzer-{target}.gz",
      binary_name: "rust-analyzer",
      gzip: true,
      target_style: GithubTargetStyle::RustTriple,
    }),
    http: None,
    go: None,
    root_markers: &["Cargo.toml"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "gopls",
    command: &["gopls"],
    extensions: &[".go"],
    language_ids: &["go"],
    tier: LspTier::B,
    install: LspInstallKind::GoInstall,
    npm: None,
    github: None,
    http: None,
    go: Some(GoInstallSpec {
      package: "golang.org/x/tools/gopls@v0.18.1",
      binary_name: "gopls",
      version_key: "v0.18.1",
    }),
    root_markers: &["go.mod"],
    requires_trust: false,
  },
  npm_spec!(
    "bash",
    &["bash-language-server", "start"],
    &[".sh", ".bash", ".zsh", ".ksh"],
    &["shellscript", "shellscript", "shellscript", "shellscript"],
    LspTier::B,
    &["bash-language-server@5.4.3"],
    "node_modules/bash-language-server/out/cli.js",
    &[]
  ),
  npm_spec!(
    "html",
    &["vscode-html-language-server", "--stdio"],
    &[".html", ".htm"],
    &["html", "html"],
    LspTier::B,
    &["vscode-langservers-extracted@4.10.0"],
    "node_modules/vscode-langservers-extracted/bin/vscode-html-language-server",
    &[]
  ),
  npm_spec!(
    "css",
    &["vscode-css-language-server", "--stdio"],
    &[".css", ".scss", ".less"],
    &["css", "scss", "less"],
    LspTier::B,
    &["vscode-langservers-extracted@4.10.0"],
    "node_modules/vscode-langservers-extracted/bin/vscode-css-language-server",
    &[]
  ),
  npm_spec!(
    "tailwindcss",
    &["tailwindcss-language-server", "--stdio"],
    &[".html", ".vue", ".tsx", ".jsx", ".svelte", ".astro", ".css"],
    &["html", "vue", "typescriptreact", "javascriptreact", "svelte", "astro", "css"],
    LspTier::B,
    &["@tailwindcss/language-server@0.0.27"],
    "node_modules/@tailwindcss/language-server/bin/tailwindcss-language-server",
    &["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs", "tailwind.config.mjs"]
  ),
  npm_spec!(
    "svelte",
    &["svelteserver", "--stdio"],
    &[".svelte"],
    &["svelte"],
    LspTier::B,
    &["svelte-language-server@0.17.10"],
    "node_modules/svelte-language-server/bin/server.js",
    &["package.json"]
  ),
  npm_spec!(
    "astro",
    &["astro-ls", "--stdio"],
    &[".astro"],
    &["astro"],
    LspTier::B,
    &["@astrojs/language-server@2.15.4"],
    "node_modules/@astrojs/language-server/bin/nodeServer.js",
    &["package.json", "astro.config.mjs", "astro.config.ts"]
  ),
  npm_spec!(
    "prisma",
    &["prisma-language-server", "--stdio"],
    &[".prisma"],
    &["prisma"],
    LspTier::B,
    &["@prisma/language-server@6.5.0"],
    "node_modules/@prisma/language-server/dist/bin.js",
    &["schema.prisma"]
  ),
  npm_spec!(
    "graphql",
    &["graphql-lsp", "server", "--method", "stream"],
    &[".graphql", ".gql"],
    &["graphql", "graphql"],
    LspTier::B,
    &["graphql-language-service-cli@3.5.0"],
    "node_modules/graphql-language-service-cli/bin/graphql.js",
    &[]
  ),
  npm_spec!(
    "dockerfile",
    &["docker-langserver", "--stdio"],
    &[".dockerfile"],
    &["dockerfile"],
    LspTier::B,
    &["dockerfile-language-server-nodejs@0.13.0"],
    "node_modules/dockerfile-language-server-nodejs/lib/server.js",
    &["Dockerfile"]
  ),
  BuiltinLspSpec {
    id: "lua",
    command: &["lua-language-server"],
    extensions: &[".lua"],
    language_ids: &["lua"],
    tier: LspTier::B,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "LuaLS/lua-language-server",
      tag: "3.13.6",
      asset: "lua-language-server-{version}-{target}.tar.gz",
      binary_name: "bin/lua-language-server",
      gzip: false,
      target_style: GithubTargetStyle::NodeStyle,
    }),
    http: None,
    go: None,
    root_markers: &[],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "clangd",
    command: &["clangd"],
    extensions: &[".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".m", ".mm"],
    language_ids: &["c", "c", "cpp", "cpp", "cpp", "cpp", "objective-c", "objective-cpp"],
    tier: LspTier::B,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "clangd/clangd",
      tag: "19.1.2",
      asset: "clangd-{target}-{version}.zip",
      binary_name: "clangd",
      gzip: false,
      target_style: GithubTargetStyle::ClangdOs,
    }),
    http: None,
    go: None,
    root_markers: &["compile_commands.json", "CMakeLists.txt"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "terraform",
    command: &["terraform-ls", "serve"],
    extensions: &[".tf", ".tfvars"],
    language_ids: &["terraform", "terraform-vars"],
    tier: LspTier::B,
    install: LspInstallKind::HttpArchive,
    npm: None,
    github: None,
    http: Some(HttpArchiveSpec {
      url: "https://releases.hashicorp.com/terraform-ls/{version}/terraform-ls_{version}_{target}.zip",
      binary_name: "terraform-ls",
      version_key: "0.36.4",
      target_style: Some(GithubTargetStyle::HashicorpOsArch),
    }),
    go: None,
    root_markers: &[],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "toml",
    command: &["taplo", "lsp", "stdio"],
    extensions: &[".toml"],
    language_ids: &["toml"],
    tier: LspTier::B,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "tamasfe/taplo",
      tag: "0.9.3",
      asset: "taplo-full-{target}.gz",
      binary_name: "taplo",
      gzip: true,
      target_style: GithubTargetStyle::TaploOsArch,
    }),
    http: None,
    go: None,
    root_markers: &[],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "zig",
    command: &["zls"],
    extensions: &[".zig", ".zon"],
    language_ids: &["zig", "zon"],
    tier: LspTier::B,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "zigtools/zls",
      tag: "0.13.0",
      asset: "zls-{target}.tar.xz",
      binary_name: "zls",
      gzip: false,
      target_style: GithubTargetStyle::ZigOsArch,
    }),
    http: None,
    go: None,
    root_markers: &["build.zig"],
    requires_trust: false,
  },
  npm_spec!(
    "php",
    &["intelephense", "--stdio"],
    &[".php"],
    &["php"],
    LspTier::B,
    &["intelephense@1.14.4"],
    "node_modules/intelephense/lib/intelephense.js",
    &["composer.json"]
  ),
  BuiltinLspSpec {
    id: "kotlin",
    command: &["kotlin-language-server"],
    extensions: &[".kt", ".kts"],
    language_ids: &["kotlin", "kotlin"],
    tier: LspTier::B,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "fwcd/kotlin-language-server",
      tag: "1.3.13",
      asset: "server.zip",
      binary_name: "bin/kotlin-language-server",
      gzip: false,
      target_style: GithubTargetStyle::RustTriple,
    }),
    http: None,
    go: None,
    root_markers: &["build.gradle", "build.gradle.kts", "settings.gradle"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "xml",
    command: &["lemminx"],
    extensions: &[".xml", ".xsd", ".xsl"],
    language_ids: &["xml", "xsd", "xsl"],
    tier: LspTier::B,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "redhat-developer/vscode-xml",
      tag: "0.29.0",
      asset: "lemminx-{target}.zip",
      binary_name: "lemminx",
      gzip: false,
      target_style: GithubTargetStyle::LemminxOs,
    }),
    http: None,
    go: None,
    root_markers: &[],
    requires_trust: false,
  },
  npm_spec!(
    "sql",
    &["sql-language-server", "up", "--method", "stdio"],
    &[".sql"],
    &["sql"],
    LspTier::B,
    &["sql-language-server@1.7.0"],
    "node_modules/sql-language-server/npm_bin/cli.js",
    &[]
  ),
  // Tier C toolchain
  BuiltinLspSpec {
    id: "deno",
    command: &["deno", "lsp"],
    extensions: &[".ts", ".tsx", ".js", ".jsx"],
    language_ids: &["typescript", "typescriptreact", "javascript", "javascriptreact"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["deno.json", "deno.jsonc"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "ruby",
    command: &["ruby-lsp"],
    extensions: &[".rb", ".rake", ".gemspec", ".ru"],
    language_ids: &["ruby", "ruby", "ruby", "ruby"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["Gemfile"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "java",
    command: &["jdtls"],
    extensions: &[".java"],
    language_ids: &["java"],
    tier: LspTier::B,
    install: LspInstallKind::HttpArchive,
    npm: None,
    github: None,
    http: Some(HttpArchiveSpec {
      url: "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz",
      binary_name: "jdtls",
      version_key: "latest",
      target_style: None,
    }),
    go: None,
    root_markers: &["pom.xml", "build.gradle", "build.gradle.kts"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "csharp",
    command: &["csharp-ls"],
    extensions: &[".cs", ".csx"],
    language_ids: &["csharp", "csharp"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["*.csproj", "*.sln"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "swift",
    command: &["sourcekit-lsp"],
    extensions: &[".swift"],
    language_ids: &["swift"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["Package.swift"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "elixir",
    command: &["elixir-ls"],
    extensions: &[".ex", ".exs"],
    language_ids: &["elixir", "elixir"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["mix.exs"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "haskell",
    command: &["haskell-language-server-wrapper", "--lsp"],
    extensions: &[".hs", ".lhs"],
    language_ids: &["haskell", "haskell"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["stack.yaml", "cabal.project"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "clojure",
    command: &["clojure-lsp"],
    extensions: &[".clj", ".cljs", ".cljc", ".edn"],
    language_ids: &["clojure", "clojure", "clojure", "clojure"],
    tier: LspTier::C,
    install: LspInstallKind::GithubRelease,
    npm: None,
    github: Some(GithubReleaseSpec {
      repo: "clojure-lsp/clojure-lsp",
      tag: "2026.07.06-14.34.19",
      asset: "clojure-lsp-native-{target}.zip",
      binary_name: "clojure-lsp",
      gzip: false,
      target_style: GithubTargetStyle::ClojureNative,
    }),
    http: None,
    go: None,
    root_markers: &["deps.edn", "project.clj"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "ocaml",
    command: &["ocamllsp"],
    extensions: &[".ml", ".mli"],
    language_ids: &["ocaml", "ocaml"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["dune-project"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "dart",
    command: &["dart", "language-server", "--protocol=lsp"],
    extensions: &[".dart"],
    language_ids: &["dart"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["pubspec.yaml"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "gleam",
    command: &["gleam", "lsp"],
    extensions: &[".gleam"],
    language_ids: &["gleam"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["gleam.toml"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "nix",
    command: &["nil"],
    extensions: &[".nix"],
    language_ids: &["nix"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["flake.nix"],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "r",
    command: &["R", "--slave", "-e", "languageserver::run()"],
    extensions: &[".r", ".R"],
    language_ids: &["r", "r"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &[],
    requires_trust: false,
  },
  BuiltinLspSpec {
    id: "scala",
    command: &["metals"],
    extensions: &[".scala", ".sc"],
    language_ids: &["scala", "scala"],
    tier: LspTier::C,
    install: LspInstallKind::ToolchainPath,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["build.sbt"],
    requires_trust: false,
  },
  // Tier D trusted project-local
  BuiltinLspSpec {
    id: "eslint",
    command: &["vscode-eslint-language-server", "--stdio"],
    extensions: &[".ts", ".tsx", ".js", ".jsx", ".vue"],
    language_ids: &["typescript", "typescriptreact", "javascript", "javascriptreact", "vue"],
    tier: LspTier::D,
    install: LspInstallKind::None,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["package.json"],
    requires_trust: true,
  },
  BuiltinLspSpec {
    id: "oxlint",
    command: &["oxlint", "--lsp"],
    extensions: &[".ts", ".tsx", ".js", ".jsx", ".vue", ".astro", ".svelte"],
    language_ids: &["typescript", "typescriptreact", "javascript", "javascriptreact", "vue", "astro", "svelte"],
    tier: LspTier::D,
    install: LspInstallKind::None,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["package.json"],
    requires_trust: true,
  },
  BuiltinLspSpec {
    id: "biome",
    command: &["biome", "lsp-proxy"],
    extensions: &[".ts", ".tsx", ".js", ".jsx", ".json", ".css"],
    language_ids: &["typescript", "typescriptreact", "javascript", "javascriptreact", "json", "css"],
    tier: LspTier::D,
    install: LspInstallKind::None,
    npm: None,
    github: None,
    http: None,
    go: None,
    root_markers: &["biome.json", "biome.jsonc"],
    requires_trust: true,
  },
];

pub fn builtin_server_map() -> HashMap<String, (Vec<String>, Vec<String>, serde_json::Value)> {
    let mut map = HashMap::new();
    for spec in BUILTINS {
        if spec.tier == LspTier::D {
            continue;
        }
        let command = spec.command.iter().map(|s| (*s).to_string()).collect();
        let extensions = spec.extensions.iter().map(|s| (*s).to_string()).collect();
        let initialization = if spec.id == "vue" {
            // Vue LS 3 hybrid mode: script/TS features come from typescript-language-server
            // + @vue/typescript-plugin. The client must bridge tsserver/request notifications.
            serde_json::json!({
              "vue": { "complete": { "codelenses": true } }
            })
        } else {
            serde_json::json!({})
        };
        map.insert(spec.id.to_string(), (command, extensions, initialization));
    }
    map
}
