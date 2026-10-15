const INSTANCE_SEP: char = '\u{1e}';

pub fn lsp_instance_key(server_id: &str, workspace_root: &str) -> String {
    format!("{server_id}{INSTANCE_SEP}{workspace_root}")
}

pub fn lsp_logical_id(key: &str) -> &str {
    match key.split_once(INSTANCE_SEP) {
        Some((id, _)) => id,
        None => key,
    }
}

pub fn lookup_managed_key<'a>(
    keys: impl IntoIterator<Item = &'a str>,
    server_id: &str,
    workspace_root: Option<&str>,
) -> Option<String> {
    let keys: Vec<&str> = keys.into_iter().collect();
    if let Some(root) = workspace_root {
        let key = lsp_instance_key(server_id, root);
        if keys.iter().any(|existing| *existing == key) {
            return Some(key);
        }
        return None;
    }

    if keys.iter().any(|existing| *existing == server_id) {
        return Some(server_id.to_string());
    }

    let matches: Vec<&str> = keys
        .into_iter()
        .filter(|key| lsp_logical_id(key) == server_id)
        .collect();
    if matches.len() == 1 {
        Some(matches[0].to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{lookup_managed_key, lsp_instance_key, lsp_logical_id};

    #[test]
    fn instance_key_round_trips_the_logical_id() {
        let key = lsp_instance_key("typescript", "/tmp/api");
        assert_eq!(lsp_logical_id(&key), "typescript");
        assert_eq!(lsp_logical_id("typescript"), "typescript");
    }

    #[test]
    fn explicit_root_matches_own_instance() {
        let api = lsp_instance_key("typescript", "/tmp/api");
        let web = lsp_instance_key("typescript", "/tmp/web");
        let keys = [api.as_str(), web.as_str()];
        assert_eq!(
            lookup_managed_key(keys, "typescript", Some("/tmp/web")),
            Some(web)
        );
    }

    #[test]
    fn explicit_root_does_not_fall_back_to_another_root() {
        let api = lsp_instance_key("typescript", "/tmp/api");
        let keys = [api.as_str()];
        assert_eq!(
            lookup_managed_key(keys, "typescript", Some("/tmp/web")),
            None
        );
    }

    #[test]
    fn omitted_root_falls_back_to_the_sole_instance() {
        let api = lsp_instance_key("typescript", "/tmp/api");
        let keys = [api.as_str()];
        assert_eq!(lookup_managed_key(keys, "typescript", None), Some(api));
    }

    #[test]
    fn omitted_root_does_not_pick_among_multiple_instances() {
        let api = lsp_instance_key("typescript", "/tmp/api");
        let web = lsp_instance_key("typescript", "/tmp/web");
        let keys = [api.as_str(), web.as_str()];
        assert_eq!(lookup_managed_key(keys, "typescript", None), None);
    }
}
