//! CEF subprocess helper (renderer / GPU / utility).
//! Built with `--features cef`. Path resolution matches the main app
//! (`cef_paths`): bundled Frameworks on macOS, CEF_PATH / export-cef-dir in dev.

#[allow(dead_code)]
#[path = "../cef_paths.rs"]
mod cef_paths;

fn main() {
  #[cfg(target_os = "macos")]
  {
    use cef::{args::Args, *};
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let paths = cef_paths::resolve(None).expect("resolve CEF paths");
    let framework = paths.framework_binary();
    let path = CString::new(framework.as_os_str().as_bytes()).expect("framework path");
    assert_eq!(
      unsafe { load_library(Some(&*path.as_ptr().cast())) },
      1,
      "failed to load CEF framework at {}",
      framework.display()
    );

    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = Args::new();
    execute_process(
      Some(args.as_main_args()),
      None::<&mut App>,
      std::ptr::null_mut(),
    );
    return;
  }

  #[cfg(not(target_os = "macos"))]
  {
    // Windows / Linux: libcef is linked; execute_process handles subprocess roles.
    use cef::{args::Args, *};
    let _ = cef_paths::resolve(None);
    let args = Args::new();
    let _ = execute_process(
      Some(args.as_main_args()),
      None::<&mut App>,
      std::ptr::null_mut(),
    );
  }
}
