use std::path::Path;

const VUE_NUXT_MARKERS: &[&str] = &[
    "nuxt.config.ts",
    "nuxt.config.js",
    "nuxt.config.mjs",
    "nuxt.config.cjs",
    "vue.config.js",
    "vue.config.ts",
    ".nuxtrc",
    ".nuxt",
];

fn dep_map_is_vue_nuxt(map: &serde_json::Map<String, serde_json::Value>) -> bool {
    map.contains_key("vue")
        || map.contains_key("nuxt")
        || map.keys().any(|name| name.starts_with("@nuxt/"))
}

fn package_json_is_vue_nuxt(root: &Path) -> bool {
    let path = root.join("package.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    for key in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(map) = value.get(key).and_then(|entry| entry.as_object()) {
            if dep_map_is_vue_nuxt(map) {
                return true;
            }
        }
    }
    false
}

/// True when the workspace is Vue or Nuxt. Bare `package.json` is not enough.
/// React-only (react in deps, no vue/nuxt) is false.
pub fn workspace_is_vue_nuxt(root: &Path) -> bool {
    if VUE_NUXT_MARKERS
        .iter()
        .any(|marker| root.join(marker).exists())
    {
        return true;
    }
    package_json_is_vue_nuxt(root)
}
