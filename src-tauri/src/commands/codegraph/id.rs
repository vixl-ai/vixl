use std::path::Path;

use sha2::{Digest, Sha256};

/// Stable graph id: full sha256 hex of the canonical absolute project root.
pub fn graph_id_for_root(canonical_root: &Path) -> String {
    let digest = Sha256::digest(canonical_root.to_string_lossy().as_bytes());
    format!("{digest:x}")
}
