use std::fs::{self, File};
use std::io::{copy, Cursor};
use std::path::Path;

use flate2::read::GzDecoder;
use xz2::read::XzDecoder;
use zip::ZipArchive;

pub fn extract_tar_gz_bytes(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let decoder = GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest).map_err(|e| e.to_string())
}

pub fn extract_tar_xz_bytes(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let decoder = XzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest).map_err(|e| e.to_string())
}

pub fn extract_archive_bytes(bytes: &[u8], url: &str, dest: &Path) -> Result<(), String> {
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

pub fn extract_zip_bytes(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let out_path = dest.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&out_path).map_err(|e| e.to_string())?;
        copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                fs::set_permissions(&out_path, fs::Permissions::from_mode(mode & 0o777))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn write_gzip_file(bytes: &[u8], dest: &Path) -> Result<(), String> {
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
