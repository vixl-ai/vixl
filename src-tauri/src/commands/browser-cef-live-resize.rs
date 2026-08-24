//! Hide CEF child NSViews for the duration of an OS live-resize drag.
//!
//! WKWebView often lags the window frame, so a visible CEF sibling (or a
//! Chromium subview with WidthSizable) paints into the new gap. Frontend
//! ResizeObserver does not fire for inactive `v-show` tabs. Observe
//! `NSWindowWillStartLiveResizeNotification` only; do not unhide on DidEnd.
//! The host ResizeObserver + settle restores the active tab after layout
//! quiets. Inactive sessions stay hidden.

use std::ffi::c_void;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, sel, AllocAnyThread};
use objc2_app_kit::{
  NSAutoresizingMaskOptions, NSView, NSWindow, NSWindowWillStartLiveResizeNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol};

static INSTALLED: AtomicBool = AtomicBool::new(false);
static OBSERVER: OnceLock<Retained<LiveResizeObserver>> = OnceLock::new();

define_class!(
  #[unsafe(super = NSObject)]
  #[name = "VixlCefLiveResizeObserver"]
  struct LiveResizeObserver;

  unsafe impl NSObjectProtocol for LiveResizeObserver {}

  impl LiveResizeObserver {
    #[unsafe(method(onWillStartLiveResize:))]
    fn on_will_start_live_resize(&self, _notification: &NSNotification) {
      hide_all_session_nsviews();
    }
  }
);

impl LiveResizeObserver {
  fn new() -> Retained<Self> {
    let this = Self::alloc().set_ivars(());
    unsafe { msg_send![super(this), init] }
  }
}

/// Pin `NSViewNotSizable` on the CEF host NSView only.
///
/// Do not walk Chromium subviews. Those use WidthSizable to fill the host
/// after `setFrame`. Pinning them at 0x0 (create uses hidden bounds) leaves
/// a black hole after show.
pub fn pin_nsview_not_sizable(view: &NSView) {
  view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewNotSizable);
}

/// Hide every CEF session NSView and pin autoresizing masks to 0.
///
/// Uses `try_lock` and drops the map before AppKit calls so `setFrame` /
/// `setHidden` cannot deadlock if AppKit re-enters. No-op when CEF is not
/// ready or the map is empty / contended.
pub fn hide_all_session_nsviews() {
  let Some(handles) = super::session_window_handles_try() else {
    return;
  };
  for handle in handles {
    hide_and_pin_nsview(handle);
  }
}

fn hide_and_pin_nsview(handle: cef::sys::cef_window_handle_t) {
  if handle.is_null() {
    return;
  }
  let result = objc2::exception::catch(AssertUnwindSafe(|| {
    unsafe {
      let view = &*(handle as *const NSView);
      view.setHidden(true);
      pin_nsview_not_sizable(view);
    }
  }));
  if let Err(exc) = result {
    match exc {
      Some(e) => log::warn!("CEF live-resize hide threw ObjC exception: {e}"),
      None => log::warn!("CEF live-resize hide threw nil ObjC exception"),
    }
  }
}

/// Observe live-resize start on the window that owns `content` (once).
///
/// Safe if CEF sessions do not exist yet: hide_all no-ops.
pub fn install_on_content_view(content: *mut c_void) {
  if content.is_null() {
    return;
  }
  if INSTALLED.load(Ordering::SeqCst) {
    return;
  }

  let window = unsafe {
    let view = &*(content as *const NSView);
    view.window()
  };
  let Some(window) = window else {
    return;
  };

  install_on_ns_window(&window);
}

fn install_on_ns_window(window: &NSWindow) {
  if INSTALLED.swap(true, Ordering::SeqCst) {
    return;
  }

  let observer = LiveResizeObserver::new();
  unsafe {
    let center = NSNotificationCenter::defaultCenter();
    let observer_obj: &AnyObject = &*observer;
    let window_obj: &AnyObject = window;
    let _: () = msg_send![
      &*center,
      addObserver: observer_obj,
      selector: sel!(onWillStartLiveResize:),
      name: NSWindowWillStartLiveResizeNotification,
      object: window_obj
    ];
  }

  if OBSERVER.set(observer).is_err() {
    log::warn!("CEF live-resize observer already stored");
  }
  log::info!("installed NSWindowWillStartLiveResizeNotification hide for CEF");
}
