//! CEF Client + LifeSpanHandler for Alloy child browsers.
//!
//! Child NSViews must not propagate OS close to the parent NSWindow. Default
//! `DoClose` returns 0, so CEF calls `performClose:` on the main Vixl window
//! when `close_browser` runs. Returning 1 treats close as handled and skips
//! that parent-window notification.

use cef::*;

wrap_life_span_handler! {
  pub struct ChildLifeSpanHandler;
  impl LifeSpanHandler {
    fn do_close(&self, _browser: Option<&mut Browser>) -> ::std::os::raw::c_int {
      1
    }
  }
}

wrap_client! {
  pub struct SpikeClient {
    life_span: LifeSpanHandler,
  }
  impl Client {
    fn life_span_handler(&self) -> Option<LifeSpanHandler> {
      Some(self.life_span.clone())
    }
  }
}
