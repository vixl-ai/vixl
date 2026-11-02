use std::path::Path;

use sha2::{Digest, Sha256};

/// Stable graph id: full sha256 hex of the identity string.
pub fn graph_id_for_identity(identity: &str) -> String {
    let digest = Sha256::digest(identity.as_bytes());
    format!("{digest:x}")
}

/// Stable graph id: full sha256 hex of the canonical absolute project root.
pub fn graph_id_for_root(canonical_root: &Path) -> String {
    graph_id_for_identity(&canonical_root.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn ssh_uri_id_is_stable_and_differs_from_local_suffix() {
        let uri = "ssh://user@host.example/tmp/proj";
        assert_eq!(graph_id_for_identity(uri), graph_id_for_identity(uri));
        assert_ne!(
            graph_id_for_identity(uri),
            graph_id_for_root(Path::new("/tmp/proj"))
        );
        assert_eq!(graph_id_for_identity(uri).len(), 64);
    }
}
