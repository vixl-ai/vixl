use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use app_lib::commands::lsp_registry::{
  builtin_spec_by_id, language_id_for_extension, root_marker_score, tier_rank, GithubTargetStyle,
  LspInstallKind, LspTier,
};

fn temp_dir(label: &str) -> std::path::PathBuf {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  let dir = std::env::temp_dir().join(format!("vixl-lsp-registry-{label}-{nanos}"));
  fs::create_dir_all(&dir).unwrap();
  dir
}

#[test]
fn root_marker_score_prefers_deno_json_over_package_json() {
  let dir = temp_dir("deno");
  fs::write(dir.join("package.json"), "{}").unwrap();
  fs::write(dir.join("deno.json"), "{}").unwrap();

  let typescript = builtin_spec_by_id("typescript").unwrap();
  let deno = builtin_spec_by_id("deno").unwrap();

  assert!(root_marker_score(Some(&dir), deno) < root_marker_score(Some(&dir), typescript));
  let _ = fs::remove_dir_all(&dir);
}

#[test]
fn root_marker_score_prefers_typescript_without_deno_json() {
  let dir = temp_dir("node");
  fs::write(dir.join("package.json"), "{}").unwrap();

  let typescript = builtin_spec_by_id("typescript").unwrap();
  let deno = builtin_spec_by_id("deno").unwrap();

  assert!(root_marker_score(Some(&dir), typescript) < root_marker_score(Some(&dir), deno));
  let _ = fs::remove_dir_all(&dir);
}

#[test]
fn root_marker_score_prefers_nuxt_config_over_generic_package_json_alone() {
  let dir = temp_dir("nuxt");
  fs::write(dir.join("package.json"), "{}").unwrap();
  fs::write(dir.join("nuxt.config.ts"), "export default {}").unwrap();

  let vue = builtin_spec_by_id("vue").unwrap();
  let deno = builtin_spec_by_id("deno").unwrap();

  assert!(root_marker_score(Some(&dir), vue) < root_marker_score(Some(&dir), deno));
  let _ = fs::remove_dir_all(&dir);
}

#[test]
fn language_id_for_extension_covers_systems_langs() {
  assert_eq!(language_id_for_extension("astro"), "astro");
  assert_eq!(language_id_for_extension("zig"), "zig");
  assert_eq!(language_id_for_extension("java"), "java");
  assert_eq!(language_id_for_extension("cpp"), "cpp");
  assert_eq!(language_id_for_extension("c"), "c");
}

#[test]
fn java_is_managed_http_archive_tier_b() {
  let java = builtin_spec_by_id("java").unwrap();
  assert_eq!(java.tier, LspTier::B);
  assert_eq!(java.install, LspInstallKind::HttpArchive);
  assert!(java.http.is_some());
}

#[test]
fn fixed_github_asset_styles_match_release_conventions() {
  let lua = builtin_spec_by_id("lua").unwrap();
  assert_eq!(
    lua.github.as_ref().unwrap().target_style,
    GithubTargetStyle::NodeStyle
  );

  let toml = builtin_spec_by_id("toml").unwrap();
  let toml_gh = toml.github.as_ref().unwrap();
  assert_eq!(toml_gh.tag, "0.9.3");
  assert_eq!(toml_gh.target_style, GithubTargetStyle::TaploOsArch);

  let clojure = builtin_spec_by_id("clojure").unwrap();
  let clojure_gh = clojure.github.as_ref().unwrap();
  assert_eq!(clojure_gh.tag, "2026.07.06-14.34.19");
  assert_eq!(clojure_gh.target_style, GithubTargetStyle::ClojureNative);

  let xml = builtin_spec_by_id("xml").unwrap();
  assert_eq!(
    xml.github.as_ref().unwrap().target_style,
    GithubTargetStyle::LemminxOs
  );
}

#[test]
fn terraform_uses_hashicorp_http_archive() {
  let terraform = builtin_spec_by_id("terraform").unwrap();
  assert_eq!(terraform.install, LspInstallKind::HttpArchive);
  let http = terraform.http.as_ref().unwrap();
  assert_eq!(http.version_key, "0.36.4");
  assert_eq!(
    http.target_style,
    Some(GithubTargetStyle::HashicorpOsArch)
  );
  assert!(http.url.contains("releases.hashicorp.com"));
}

#[test]
fn gopls_uses_go_install_and_nix_is_toolchain() {
  let gopls = builtin_spec_by_id("gopls").unwrap();
  assert_eq!(gopls.install, LspInstallKind::GoInstall);
  assert!(gopls.go.is_some());

  let nix = builtin_spec_by_id("nix").unwrap();
  assert_eq!(nix.install, LspInstallKind::ToolchainPath);
  assert!(nix.github.is_none());
}

#[test]
fn tier_rank_orders_a_before_c() {
  assert!(tier_rank(LspTier::A) < tier_rank(LspTier::C));
}
