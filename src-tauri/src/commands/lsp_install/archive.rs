use std::fs::{self, File};
use std::io::{copy, Write};
use std::path::Path;

use flate2::read::GzDecoder;

pub(crate) fn extract_tar_gz_bytes(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let decoder = GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest).map_err(|e| e.to_string())
}

pub(crate) fn extract_tar_xz_bytes(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let tmp = dest.join(".download.tar.xz");
    {
        let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
    }

    let status = std::process::Command::new("tar")
        .args([
            "-xJf",
            &tmp.to_string_lossy(),
            "-C",
            &dest.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("Failed to run tar for .tar.xz extract: {e}"))?;
    let _ = fs::remove_file(&tmp);
    if !status.success() {
        return Err("Failed to extract .tar.xz archive (install xz/tar support)".to_string());
    }
    Ok(())
}

pub(crate) fn extract_archive_bytes(bytes: &[u8], url: &str, dest: &Path) -> Result<(), String> {
    if url.ends_with(".tar.xz") {
        extract_tar_xz_bytes(bytes, dest)
    } else if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
        extract_tar_gz_bytes(bytes, dest)
    } else if url.ends_with(".zip") {
        extract_zip_bytes(bytes, dest)
    } else if url.ends_with(".gz") {
        Err("Single-file .gz requires a destination binary path".to_string())
    } else {
        Err(format!("Unsupported archive type for {url}"))
    }
}

pub(crate) fn extract_zip_bytes(bytes: &[u8], dest: &Path) -> Result<(), String> {
    // Minimal zip extract without zip crate: write temp and use system unzip when needed.
    // Prefer writing a .zip and extracting with `tar`/`Expand-Archive` via std process.
    let tmp = dest.join(".download.zip");
    {
        let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        let status = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    tmp.display(),
                    dest.display()
                ),
            ])
            .status()
            .map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&tmp);
        if !status.success() {
            return Err("Failed to extract zip archive".to_string());
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let status = std::process::Command::new("unzip")
            .args([
                "-o",
                "-q",
                &tmp.to_string_lossy(),
                "-d",
                &dest.to_string_lossy(),
            ])
            .status()
            .map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&tmp);
        if !status.success() {
            return Err("Failed to extract zip archive (install unzip)".to_string());
        }
        Ok(())
    }
}

pub(crate) fn write_gzip_file(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut out = File::create(dest).map_err(|e| e.to_string())?;
    copy(&mut decoder, &mut out).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(dest, perms).map_err(|e| e.to_string())?;
    }
    Ok(())
}
