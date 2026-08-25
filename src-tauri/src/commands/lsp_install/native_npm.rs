use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::super::lsp_registry::NpmInstallSpec;

pub fn node_typescript_platform_package() -> Option<String> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "ia32",
        "arm" => "arm",
        "powerpc64" => "ppc64",
        "s390x" => "s390x",
        "riscv64" => "riscv64",
        "loongarch64" => "loong64",
        other => other,
    };
    Some(format!("typescript-{os}-{arch}"))
}

pub fn native_typescript_exe(node_modules: &Path) -> Option<PathBuf> {
    let package = node_typescript_platform_package()?;
    let mut exe = node_modules
        .join("@typescript")
        .join(package)
        .join("lib")
        .join("tsc");
    if cfg!(windows) {
        exe.set_extension("exe");
    }
    if exe.is_file() {
        Some(exe)
    } else {
        None
    }
}

pub fn looks_like_javascript_bin(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(ext.as_str(), "js" | "mjs" | "cjs") {
        return true;
    }
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut buf = [0u8; 80];
    let n = file.read(&mut buf).unwrap_or(0);
    if n == 0 {
        return false;
    }
    if buf.starts_with(b"\x7fELF") || buf.starts_with(b"MZ") || buf.starts_with(b"\xcf\xfa") {
        return false;
    }
    let text = String::from_utf8_lossy(&buf[..n]);
    let trimmed = text.trim_start();
    if trimmed.starts_with("#!") {
        return trimmed.to_ascii_lowercase().contains("node");
    }
    trimmed.starts_with("import ")
        || trimmed.starts_with("'use strict")
        || trimmed.starts_with("\"use strict")
}

pub fn should_wrap_npm_bin_with_node(npm: &NpmInstallSpec, bin_path: &Path) -> bool {
    if npm.native {
        return false;
    }
    looks_like_javascript_bin(bin_path)
}

pub fn managed_native_npm_bin(install_dir: &Path, npm: &NpmInstallSpec) -> Option<PathBuf> {
    if npm.native {
        if let Some(exe) = native_typescript_exe(&install_dir.join("node_modules")) {
            return Some(exe);
        }
    }
    let candidate = install_dir.join(npm.bin);
    if candidate.is_file() {
        return Some(candidate);
    }
    if cfg!(windows) {
        let exe = candidate.with_extension("exe");
        if exe.is_file() {
            return Some(exe);
        }
        let cmd = candidate.with_extension("cmd");
        if cmd.is_file() {
            return Some(cmd);
        }
    }
    None
}
