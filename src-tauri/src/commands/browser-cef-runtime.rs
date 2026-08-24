//! CEF runtime: warm-init, multi-session child browsers, CDP target mapping.
//!
//! All CEF browsers share one DevTools remote-debugging port
//! (`REMOTE_DEBUGGING_PORT`). After create, a background thread claims the
//! page-target WebSocket URL via `/json/list` (never on the Tauri main thread).
//! `browser_cef_get_cdp_ws_url` returns the cached URL or "not ready yet".
//! Navigation uses the CEF BrowserHost API (not CDP).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Window};

use crate::cef_paths::{self, CefPaths};

pub(super) const REMOTE_DEBUGGING_PORT: i32 = 9333;

/// Effective DevTools port (default `REMOTE_DEBUGGING_PORT`, overridable via
/// `CEF_REMOTE_DEBUGGING_PORT` for spike/dev when 9333 is already taken).
pub(super) fn remote_debugging_port() -> i32 {
  static PORT: OnceLock<i32> = OnceLock::new();
  *PORT.get_or_init(|| {
    std::env::var("CEF_REMOTE_DEBUGGING_PORT")
      .ok()
      .and_then(|s| s.parse().ok())
      .filter(|&p| (1..65536).contains(&p))
      .unwrap_or(REMOTE_DEBUGGING_PORT)
  })
}

static CEF_READY: AtomicBool = AtomicBool::new(false);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
static CLAIMED_TARGETS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static CEF_PATHS: OnceLock<CefPaths> = OnceLock::new();
static LAST_WARM_INIT_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CefBounds {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

struct Session {
  browser: cef::Browser,
  /// DevTools page target id from /json/list, when known.
  cdp_target_id: Option<String>,
  /// Page-target WebSocket debugger URL, when known.
  cdp_ws_url: Option<String>,
}

#[cfg(target_os = "macos")]
#[path = "browser-cef-cr-app-protocol.rs"]
mod cr_app_protocol;

#[cfg(target_os = "macos")]
#[path = "browser-cef-stacking.rs"]
mod stacking;

#[cfg(target_os = "macos")]
#[path = "browser-cef-live-resize.rs"]
mod live_resize;

#[cfg(target_os = "macos")]
#[path = "browser-cef-hit-test.rs"]
mod hit_test;

#[cfg(target_os = "macos")]
#[path = "browser-cef-client.rs"]
mod client;

/// macOS cannot use `multi_threaded_message_loop` (Windows/Linux only per CEF
/// docs). Integrate with Tauri's NSApplication run loop via
/// `external_message_pump` + `OnScheduleMessagePumpWork`, matching cefclient's
/// MainMessageLoopExternalPump: schedule `do_message_loop_work` on the main
/// GCD queue (never from a background thread via `run_on_main_thread`).
#[cfg(target_os = "macos")]
mod message_pump {
  use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
  use std::time::Duration;

  use dispatch2::{DispatchQueue, DispatchTime};

  use super::CEF_READY;

  /// Special delay from DoWork keepalive (cefclient kTimerDelayPlaceholder).
  const TIMER_DELAY_PLACEHOLDER: i64 = i32::MAX as i64;
  /// Cap wait between pumps at ~30fps (cefclient kMaxTimerDelay).
  const MAX_TIMER_DELAY_MS: i64 = 1000 / 30;

  static PUMP_ACTIVE: AtomicBool = AtomicBool::new(false);
  static PUMP_REENTRANT: AtomicBool = AtomicBool::new(false);
  static TIMER_PENDING: AtomicBool = AtomicBool::new(false);
  static TIMER_GENERATION: AtomicU64 = AtomicU64::new(0);

  /// CEF may call this from any thread.
  pub fn schedule(delay_ms: i64) {
    DispatchQueue::main().exec_async(move || {
      on_schedule_work(delay_ms);
    });
  }

  fn on_schedule_work(delay_ms: i64) {
    if delay_ms == TIMER_DELAY_PLACEHOLDER && TIMER_PENDING.load(Ordering::SeqCst) {
      return;
    }

    let generation = TIMER_GENERATION.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    TIMER_PENDING.store(false, Ordering::SeqCst);

    if delay_ms <= 0 {
      perform_work();
      return;
    }

    let capped = delay_ms.min(MAX_TIMER_DELAY_MS).max(1) as u64;
    TIMER_PENDING.store(true, Ordering::SeqCst);
    let when = DispatchTime::try_from(Duration::from_millis(capped)).unwrap_or(DispatchTime::NOW);
    let _ = DispatchQueue::main().after(when, move || {
      if TIMER_GENERATION.load(Ordering::SeqCst) != generation {
        return;
      }
      TIMER_PENDING.store(false, Ordering::SeqCst);
      perform_work();
    });
  }

  pub fn perform_work() {
    if !CEF_READY.load(Ordering::SeqCst) {
      return;
    }
    if PUMP_ACTIVE.swap(true, Ordering::SeqCst) {
      PUMP_REENTRANT.store(true, Ordering::SeqCst);
      return;
    }
    PUMP_REENTRANT.store(false, Ordering::SeqCst);
    cef::do_message_loop_work();
    PUMP_ACTIVE.store(false, Ordering::SeqCst);

    if PUMP_REENTRANT.load(Ordering::SeqCst) {
      schedule(0);
    } else if !TIMER_PENDING.load(Ordering::SeqCst) {
      schedule(TIMER_DELAY_PLACEHOLDER);
    }
  }
}

#[cfg(target_os = "macos")]
mod macos_handlers {
  use cef::*;

  wrap_browser_process_handler! {
    pub struct SpikeBrowserProcessHandler;
    impl BrowserProcessHandler {
      fn on_schedule_message_pump_work(&self, delay_ms: i64) {
        super::message_pump::schedule(delay_ms);
      }
    }
  }

  wrap_app! {
    pub struct SpikeApp {
      browser_process_handler: BrowserProcessHandler,
    }
    impl App {
      fn on_before_command_line_processing(
        &self,
        _process_type: Option<&CefString>,
        command_line: Option<&mut CommandLine>,
      ) {
        let Some(cmd) = command_line else {
          return;
        };
        // Chrome 111+ rejects CDP without an explicit origin allowlist.
        cmd.append_switch_with_value(
          Some(&CefString::from("remote-allow-origins")),
          Some(&CefString::from("*")),
        );
        cmd.append_switch(Some(&CefString::from("disable-gpu")));
        cmd.append_switch(Some(&CefString::from("disable-gpu-compositing")));
      }

      fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
        Some(self.browser_process_handler.clone())
      }
    }
  }
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
  SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Snapshot CEF NSView handles without holding the map across AppKit calls.
/// `None` if the mutex is poisoned or contended (`try_lock`).
#[cfg(target_os = "macos")]
fn session_window_handles_try() -> Option<Vec<cef::sys::cef_window_handle_t>> {
  use cef::{ImplBrowser, ImplBrowserHost};
  let map = sessions().try_lock().ok()?;
  Some(
    map
      .values()
      .filter_map(|session| session.browser.host().map(|host| host.window_handle()))
      .collect(),
  )
}

fn claimed_targets() -> &'static Mutex<HashSet<String>> {
  CLAIMED_TARGETS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn last_warm_init_error_slot() -> &'static Mutex<Option<String>> {
  LAST_WARM_INIT_ERROR.get_or_init(|| Mutex::new(None))
}

fn store_last_warm_init_error(error: Option<String>) {
  if let Ok(mut slot) = last_warm_init_error_slot().lock() {
    *slot = error;
  }
}

pub(super) fn last_warm_init_error() -> Option<String> {
  last_warm_init_error_slot()
    .lock()
    .ok()
    .and_then(|slot| slot.clone())
}

fn cache_path(app: Option<&AppHandle>) -> PathBuf {
  if let Some(app) = app {
    if let Ok(dir) = app.path().app_cache_dir() {
      return dir.join("cef");
    }
  }
  let home = std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .unwrap_or_else(|_| ".".into());
  PathBuf::from(home).join(".vixl").join("cef-cache")
}

/// Symlink GPU libs beside the exe for unpaid-dev loads. Skip inside a signed
/// .app (would break codesign / notarization).
#[cfg(target_os = "macos")]
fn ensure_framework_libs_beside_exe(paths: &CefPaths) -> Result<(), String> {
  if cef_paths::running_inside_app_bundle() {
    return Ok(());
  }
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  let dir = exe
    .parent()
    .ok_or_else(|| "current exe has no parent".to_string())?;
  let libs = paths.framework_dir().join("Libraries");
  for name in [
    "libEGL.dylib",
    "libGLESv2.dylib",
    "libvk_swiftshader.dylib",
    "libvulkan.dylib",
    "vk_swiftshader_icd.json",
  ] {
    let target = dir.join(name);
    if target.exists() {
      continue;
    }
    let source = libs.join(name);
    if source.exists() {
      let _ = std::os::unix::fs::symlink(&source, &target);
    }
  }
  Ok(())
}

pub fn warm_init(app: &AppHandle) -> Result<(), String> {
  if CEF_READY.load(Ordering::SeqCst) {
    store_last_warm_init_error(None);
    return Ok(());
  }

  let resource_dir = app.path().resource_dir().ok();
  let paths = match cef_paths::resolve(resource_dir.as_deref()) {
    Ok(paths) => paths,
    Err(error) => {
      store_last_warm_init_error(Some(error.clone()));
      return Err(error);
    }
  };
  let _ = CEF_PATHS.set(paths);

  #[cfg(target_os = "macos")]
  {
    if let Err(error) = warm_init_macos(Some(app)) {
      store_last_warm_init_error(Some(error.clone()));
      return Err(error);
    }
    CEF_READY.store(true, Ordering::SeqCst);
    // Kick the external pump; further work is scheduled by CEF callbacks.
    message_pump::schedule(0);
    store_last_warm_init_error(None);
    log::info!(
      "CEF warm-init complete (remote debugging on port {})",
      remote_debugging_port()
    );
    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = app;
    let error = "CEF warm-init is only implemented on macOS".to_string();
    store_last_warm_init_error(Some(error.clone()));
    Err(error)
  }
}

/// Dev / spike entry that resolves CEF from `CEF_PATH` or `~/.local/share/cef`.
pub fn warm_init_dev() -> Result<(), String> {
  if CEF_READY.load(Ordering::SeqCst) {
    return Ok(());
  }

  let paths = cef_paths::resolve(None)?;
  let _ = CEF_PATHS.set(paths);

  #[cfg(target_os = "macos")]
  {
    warm_init_macos(None)?;
    CEF_READY.store(true, Ordering::SeqCst);
    message_pump::schedule(0);
    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    Err("CEF warm-init is only implemented on macOS".into())
  }
}

#[cfg(target_os = "macos")]
fn warm_init_macos(app: Option<&AppHandle>) -> Result<(), String> {
  use cef::{args::Args, *};
  use std::ffi::CString;
  use std::os::unix::ffi::OsStrExt;

  let paths = CEF_PATHS
    .get()
    .ok_or_else(|| "CEF paths not resolved".to_string())?;
  let binary = paths.framework_binary();
  if !binary.exists() {
    return Err(format!(
      "CEF framework missing at {} (set CEF_PATH, run export-cef-dir, or ship the framework in the app bundle)",
      binary.display()
    ));
  }
  ensure_framework_libs_beside_exe(paths)?;

  let path = CString::new(binary.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
  if unsafe { load_library(Some(&*path.as_ptr().cast())) } != 1 {
    return Err(format!("cef load_library failed for {}", binary.display()));
  }

  // CEF requires CrAppProtocol (isHandlingSendEvent / setHandlingSendEvent:) on
  // the shared NSApplication. Tauri's TaoApp lacks those selectors, so CEF
  // event paths such as close_browser crash with unrecognized selector
  // isHandlingSendEvent. Patch the live class before initialize; we cannot
  // replace Tauri's NSApplication subclass wholesale.
  cr_app_protocol::install()?;

  let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);

  let args = Args::new();
  let main_args = args.as_main_args();
  let ret = execute_process(Some(main_args), None::<&mut App>, std::ptr::null_mut());
  if ret >= 0 {
    return Err(format!(
      "unexpected CEF subprocess entry in main process (execute_process returned {ret})"
    ));
  }

  let mut cef_app = macos_handlers::SpikeApp::new(
    macos_handlers::SpikeBrowserProcessHandler::new(),
  );
  let helper = paths.helper.clone();
  let framework = paths.framework_dir();
  let cache = cache_path(app);
  std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;

  // macOS: multi_threaded_message_loop is unsupported. Use external_message_pump
  // and OnScheduleMessagePumpWork (see message_pump module) so CEF never blocks
  // Tauri's NSApplication run loop.
  let settings = Settings {
    no_sandbox: 1,
    external_message_pump: 1,
    remote_debugging_port: remote_debugging_port(),
    framework_dir_path: CefString::from(framework.to_string_lossy().as_ref()),
    browser_subprocess_path: CefString::from(helper.to_string_lossy().as_ref()),
    root_cache_path: CefString::from(cache.to_string_lossy().as_ref()),
    ..Default::default()
  };

  if initialize(
    Some(main_args),
    Some(&settings),
    Some(&mut cef_app),
    std::ptr::null_mut(),
  ) != 1
  {
    return Err("cef::initialize failed".into());
  }

  std::mem::forget(cef_app);

  // CEF paints behind WKWebView; clear the webview fill once so CSS holes show
  // the native browser. Safe no-op if the webview is not ready yet (create retries).
  if let Some(app) = app {
    if let Some(window) = app.get_webview_window("main") {
      if let Ok(ns_view) = window.ns_view() {
        stacking::clear_wkwebview_background(ns_view as cef::sys::cef_window_handle_t);
        live_resize::install_on_content_view(ns_view);
      }
    }
  }

  Ok(())
}

pub fn pump_on_main_thread() {
  if !CEF_READY.load(Ordering::SeqCst) {
    return;
  }
  #[cfg(target_os = "macos")]
  {
    message_pump::perform_work();
  }
}

pub fn cdp_endpoint() -> String {
  format!("http://127.0.0.1:{}", remote_debugging_port())
}

pub(super) fn ensure_ready() -> Result<(), String> {
  if CEF_READY.load(Ordering::SeqCst) {
    Ok(())
  } else if let Some(error) = last_warm_init_error() {
    Err(format!("CEF is not initialized: {error}"))
  } else {
    Err("CEF is not initialized".into())
  }
}

fn cef_string_to_std(value: &cef::CefStringUserfree) -> String {
  cef::CefString::from(value).to_string()
}

fn clamp_i32(value: f64) -> i32 {
  value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

#[cfg(target_os = "macos")]
fn parent_view_height(parent: cef::sys::cef_window_handle_t) -> f64 {
  use objc2::runtime::AnyObject;
  use objc2_app_kit::NSView;
  use objc2_foundation::NSRect;

  if parent.is_null() {
    return 0.0;
  }
  unsafe {
    let view = &*(parent as *const NSView);
    let frame: NSRect = objc2::msg_send![view as &AnyObject, bounds];
    frame.size.height
  }
}

#[cfg(target_os = "macos")]
fn css_bounds_to_cef_rect(
  parent: cef::sys::cef_window_handle_t,
  bounds: CefBounds,
) -> cef::Rect {
  let parent_h = parent_view_height(parent);
  let width = bounds.width.max(0.0);
  let height = bounds.height.max(0.0);
  let x = bounds.x;
  // CSS / getBoundingClientRect is top-left; Cocoa NSView is bottom-left.
  let y = parent_h - bounds.y - height;
  cef::Rect {
    x: clamp_i32(x),
    y: clamp_i32(y),
    width: clamp_i32(width),
    height: clamp_i32(height),
  }
}

#[cfg(target_os = "macos")]
fn apply_nsview_bounds(
  host: &cef::BrowserHost,
  parent: cef::sys::cef_window_handle_t,
  bounds: CefBounds,
) -> Result<(), String> {
  use cef::ImplBrowserHost;
  use objc2::runtime::AnyObject;
  use objc2_app_kit::NSView;
  use objc2_foundation::{NSPoint, NSRect, NSSize};

  let handle = host.window_handle();
  if handle.is_null() {
    return Err("CEF browser has no window handle".into());
  }

  let parent_h = parent_view_height(parent);
  let width = bounds.width.max(0.0);
  let height = bounds.height.max(0.0);
  let x = bounds.x;
  let y = parent_h - bounds.y - height;
  let hidden = width < 1.0 || height < 1.0;

  unsafe {
    let view = &*(handle as *const NSView);
    let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));
    let _: () = objc2::msg_send![view as &AnyObject, setFrame: frame];
    let _: () = objc2::msg_send![view as &AnyObject, setHidden: hidden];
    // Host view only. Inner Chromium views must keep WidthSizable so they
    // fill the host after create-at-zero then show.
    live_resize::pin_nsview_not_sizable(view);
  }
  // Keep CEF behind WKWebView after frame changes (AppKit can reshuffle siblings).
  stacking::send_cef_view_to_back(handle);
  host.was_resized();
  Ok(())
}

fn create_browser_with_parent(
  parent: cef::sys::cef_window_handle_t,
  bounds: CefBounds,
) -> Result<String, String> {
  ensure_ready()?;

  #[cfg(target_os = "macos")]
  {
    use cef::*;

    let cef_bounds = css_bounds_to_cef_rect(parent, bounds);
    let window_info = WindowInfo {
      runtime_style: RuntimeStyle::ALLOY,
      ..Default::default()
    }
    .set_as_child(parent, &cef_bounds);

    let mut client =
      client::SpikeClient::new(client::ChildLifeSpanHandler::new());
    let url = CefString::from("about:blank");
    let browser_settings = BrowserSettings::default();

    log::info!("CEF browser_host_create_browser_sync starting");
    let browser = browser_host_create_browser_sync(
      Some(&window_info),
      Some(&mut client),
      Some(&url),
      Some(&browser_settings),
      None,
      None,
    )
    .ok_or_else(|| "browser_host_create_browser_sync returned None".to_string())?;
    log::info!("CEF browser_host_create_browser_sync complete");

    // CEF was added last (on top of WKWebView). Send it behind so Vue chrome
    // stays visible; transparent CSS regions reveal the page underneath.
    {
      use cef::{ImplBrowser, ImplBrowserHost};
      if let Some(host) = browser.host() {
        log::info!("CEF send_cef_view_to_back after create");
        stacking::send_cef_view_to_back(host.window_handle());
        log::info!("CEF send_cef_view_to_back finished");
        // Pin NSViewNotSizable and apply CSS bounds; set_as_child alone can leave
        // an autoresizing mask that stretches during OS live-resize.
        let _ = apply_nsview_bounds(&host, parent, bounds);
      } else {
        log::warn!("CEF browser host missing after create; skipping send-to-back");
      }
    }
    stacking::clear_wkwebview_background(parent);
    live_resize::install_on_content_view(parent as *mut std::ffi::c_void);

    let session_id = NEXT_SESSION.fetch_add(1, Ordering::SeqCst).to_string();
    // Return immediately. CDP page targets are published by DevTools only while
    // the GCD external pump can run; claiming on this (main) thread would block
    // the pump and race with /json/list. Background poll fills in later.
    sessions()
      .lock()
      .map_err(|e| e.to_string())?
      .insert(
        session_id.clone(),
        Session {
          browser,
          cdp_target_id: None,
          cdp_ws_url: None,
        },
      );
    spawn_claim_cdp_target(session_id.clone());
    Ok(session_id)
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (parent, bounds);
    Err("browser_cef_create is only implemented on macOS".into())
  }
}

fn http_get_json_list() -> Result<Vec<serde_json::Value>, String> {
  let url = format!("{}/json/list", cdp_endpoint());
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(2))
    .build()
    .map_err(|e| e.to_string())?;
  let response = client.get(&url).send().map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("CDP /json/list returned {}", response.status()));
  }
  let body: serde_json::Value = response.json().map_err(|e| e.to_string())?;
  body
    .as_array()
    .cloned()
    .ok_or_else(|| "CDP /json/list was not an array".into())
}

/// One non-blocking attempt to claim an unclaimed `type=page` target.
/// Does not pump CEF; the GCD external pump must already be running.
fn try_claim_unclaimed_page_target() -> Option<(String, Option<String>)> {
  let list = http_get_json_list().ok()?;
  let mut claimed = claimed_targets().lock().ok()?;
  for item in list {
    let ty = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if ty != "page" {
      continue;
    }
    let id = match item.get("id").and_then(|v| v.as_str()) {
      Some(id) => id.to_string(),
      None => continue,
    };
    if claimed.contains(&id) {
      continue;
    }
    let ws = item
      .get("webSocketDebuggerUrl")
      .and_then(|v| v.as_str())
      .map(str::to_string);
    claimed.insert(id.clone());
    return Some((id, ws));
  }
  None
}

/// Poll `/json/list` off the main thread until a page target appears or the
/// deadline elapses. Stores `cdp_target_id` / `cdp_ws_url` on the session.
fn spawn_claim_cdp_target(session_id: String) {
  std::thread::spawn(move || {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
      {
        let Ok(map) = sessions().lock() else {
          return;
        };
        let Some(session) = map.get(&session_id) else {
          // Session destroyed before claim finished.
          return;
        };
        if session.cdp_ws_url.is_some() {
          return;
        }
      }

      if let Some((id, ws)) = try_claim_unclaimed_page_target() {
        let Ok(mut map) = sessions().lock() else {
          if let Ok(mut claimed) = claimed_targets().lock() {
            claimed.remove(&id);
          }
          return;
        };
        if let Some(session) = map.get_mut(&session_id) {
          session.cdp_target_id = Some(id);
          session.cdp_ws_url = ws;
        } else {
          // Destroyed while HTTP/claim raced; release the target id.
          drop(map);
          if let Ok(mut claimed) = claimed_targets().lock() {
            claimed.remove(&id);
          }
        }
        return;
      }

      std::thread::sleep(Duration::from_millis(40));
    }
  });
}

fn with_session<T, F>(session_id: &str, f: F) -> Result<T, String>
where
  F: FnOnce(&Session) -> Result<T, String>,
{
  ensure_ready()?;
  let map = sessions().lock().map_err(|e| e.to_string())?;
  let session = map
    .get(session_id)
    .ok_or_else(|| format!("unknown CEF session {session_id}"))?;
  f(session)
}

pub(super) fn create_browser_on_main(
  window: &Window,
  bounds: CefBounds,
) -> Result<String, String> {
  #[cfg(target_os = "macos")]
  {
    let parent = window
      .ns_view()
      .map_err(|e| format!("ns_view: {e}"))? as cef::sys::cef_window_handle_t;
    create_browser_with_parent(parent, bounds)
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (window, bounds);
    Err("browser_cef_create is only implemented on macOS".into())
  }
}

pub fn create_browser_for_spike(parent: *mut std::ffi::c_void) -> Result<String, String> {
  #[cfg(target_os = "macos")]
  {
    // On macOS, cef_window_handle_t is *mut c_void (NSView*). On Windows it is
    // HWND, so a direct cast from *mut c_void is not a primitive cast.
    create_browser_with_parent(
      parent as cef::sys::cef_window_handle_t,
      CefBounds {
        x: 8.0,
        y: 8.0,
        width: 320.0,
        height: 240.0,
      },
    )
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = parent;
    Err("create_browser_for_spike is only implemented on macOS".into())
  }
}

pub fn destroy_browser_for_spike(session_id: &str) -> Result<(), String> {
  destroy_browser_on_main(session_id)
}

pub(super) fn destroy_browser_on_main(session_id: &str) -> Result<(), String> {
  ensure_ready()?;
  let mut map = sessions().lock().map_err(|e| e.to_string())?;
  let Some(session) = map.remove(session_id) else {
    return Err(format!("unknown CEF session {session_id}"));
  };

  if let Some(target_id) = session.cdp_target_id.as_ref() {
    if let Ok(mut claimed) = claimed_targets().lock() {
      claimed.remove(target_id);
    }
  }

  #[cfg(target_os = "macos")]
  {
    use cef::{ImplBrowser, ImplBrowserHost};
    if let Some(host) = session.browser.host() {
      host.close_browser(1);
    }
    // Frontend re-publishes rects for any remaining host; clear so a destroyed
    // session cannot leave a stale hole that steals hits from Vue.
    hit_test::clear_rects();
    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session;
    Err("browser_cef_destroy is only implemented on macOS".into())
  }
}

pub(super) fn set_passthrough_rects_on_main(
  window: &Window,
  rects: Vec<CefBounds>,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let content = window
      .ns_view()
      .map_err(|e| format!("ns_view: {e}"))?;
    hit_test::install_on_content_view(content)?;
    hit_test::set_rects(rects);
    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (window, rects);
    Err("browser_cef_set_passthrough_rects is only implemented on macOS".into())
  }
}

pub(super) fn resize_browser_on_main(
  window: &Window,
  session_id: &str,
  bounds: CefBounds,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use cef::ImplBrowser;
    let parent = window
      .ns_view()
      .map_err(|e| format!("ns_view: {e}"))? as cef::sys::cef_window_handle_t;
    with_session(session_id, |session| {
      let host = session
        .browser
        .host()
        .ok_or_else(|| "CEF browser has no host".to_string())?;
      apply_nsview_bounds(&host, parent, bounds)
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (window, session_id, bounds);
    Err("browser_cef_resize is only implemented on macOS".into())
  }
}

pub(super) fn navigate_browser_on_main(session_id: &str, url: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use cef::{CefString, ImplBrowser, ImplFrame};
    with_session(session_id, |session| {
      let frame = session
        .browser
        .main_frame()
        .ok_or_else(|| "CEF browser has no main frame".to_string())?;
      frame.load_url(Some(&CefString::from(url)));
      Ok(())
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (session_id, url);
    Err("browser_cef_navigate is only implemented on macOS".into())
  }
}

pub(super) fn focus_browser_on_main(session_id: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use cef::{ImplBrowser, ImplBrowserHost};
    with_session(session_id, |session| {
      let host = session
        .browser
        .host()
        .ok_or_else(|| "CEF browser has no host".to_string())?;
      host.set_focus(1);
      Ok(())
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_focus is only implemented on macOS".into())
  }
}

pub(super) fn get_url_on_main(session_id: &str) -> Result<String, String> {
  #[cfg(target_os = "macos")]
  {
    use cef::{ImplBrowser, ImplFrame};
    with_session(session_id, |session| {
      let frame = session
        .browser
        .main_frame()
        .ok_or_else(|| "CEF browser has no main frame".to_string())?;
      Ok(cef_string_to_std(&frame.url()))
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_get_url is only implemented on macOS".into())
  }
}

pub(super) fn get_title_on_main(session_id: &str) -> Result<String, String> {
  #[cfg(target_os = "macos")]
  {
    use cef::{ImplBrowser, ImplBrowserHost, ImplNavigationEntry};
    with_session(session_id, |session| {
      let host = session
        .browser
        .host()
        .ok_or_else(|| "CEF browser has no host".to_string())?;
      let Some(entry) = host.visible_navigation_entry() else {
        return Ok(String::new());
      };
      Ok(cef_string_to_std(&entry.title()))
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_get_title is only implemented on macOS".into())
  }
}

pub(super) fn can_go_back_on_main(session_id: &str) -> Result<bool, String> {
  #[cfg(target_os = "macos")]
  {
    use cef::ImplBrowser;
    with_session(session_id, |session| {
      Ok(session.browser.can_go_back() != 0)
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_can_go_back is only implemented on macOS".into())
  }
}

pub(super) fn can_go_forward_on_main(session_id: &str) -> Result<bool, String> {
  #[cfg(target_os = "macos")]
  {
    use cef::ImplBrowser;
    with_session(session_id, |session| {
      Ok(session.browser.can_go_forward() != 0)
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_can_go_forward is only implemented on macOS".into())
  }
}

pub(super) fn go_back_on_main(session_id: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use cef::ImplBrowser;
    with_session(session_id, |session| {
      session.browser.go_back();
      Ok(())
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_go_back is only implemented on macOS".into())
  }
}

pub(super) fn go_forward_on_main(session_id: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use cef::ImplBrowser;
    with_session(session_id, |session| {
      session.browser.go_forward();
      Ok(())
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_go_forward is only implemented on macOS".into())
  }
}

pub(super) fn reload_on_main(session_id: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use cef::ImplBrowser;
    with_session(session_id, |session| {
      session.browser.reload();
      Ok(())
    })
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = session_id;
    Err("browser_cef_reload is only implemented on macOS".into())
  }
}

pub(super) fn get_cdp_ws_url_on_main(session_id: &str) -> Result<String, String> {
  // Never poll/claim on the main thread: that blocks the GCD CEF pump.
  // Background `spawn_claim_cdp_target` fills the cache; callers retry.
  with_session(session_id, |session| {
    session.cdp_ws_url.clone().ok_or_else(|| {
      format!("CDP target not ready yet for session {session_id}")
    })
  })
}
