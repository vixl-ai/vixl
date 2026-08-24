//! Standalone Phase 0 CEF runtime validator (macOS).

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

fn main() {
  #[cfg(not(target_os = "macos"))]
  {
    eprintln!("cef-spike-validate is macOS-only");
    std::process::exit(1);
  }

  #[cfg(target_os = "macos")]
  if let Err(error) = run_macos() {
    eprintln!("CEF spike validation FAILED: {error}");
    std::process::exit(1);
  }
}

#[cfg(target_os = "macos")]
fn run_macos() -> Result<(), String> {
  use objc2::{MainThreadMarker, MainThreadOnly};
  use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSWindow, NSWindowStyleMask,
  };
  use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
  use std::sync::mpsc;
  use std::time::{Duration, Instant};

  let mtm = MainThreadMarker::new().ok_or("must run on main thread")?;
  let app = NSApplication::sharedApplication(mtm);
  app.setActivationPolicy(NSApplicationActivationPolicy::Regular);

  let frame = NSRect::new(NSPoint::new(100.0, 100.0), NSSize::new(640.0, 480.0));
  let window = unsafe {
    NSWindow::initWithContentRect_styleMask_backing_defer(
      NSWindow::alloc(mtm),
      frame,
      NSWindowStyleMask::Titled | NSWindowStyleMask::Closable | NSWindowStyleMask::Resizable,
      NSBackingStoreType::Buffered,
      false,
    )
  };
  window.setTitle(&NSString::from_str("CEF spike validate"));
  window.makeKeyAndOrderFront(None);
  app.activate();

  let parent = {
    let view = window.contentView().ok_or("window has no contentView")?;
    objc2::rc::Retained::as_ptr(&view) as *mut std::ffi::c_void
  };

  println!("warm-init CEF...");
  let started = Instant::now();
  app_lib::commands::browser_cef::warm_init_dev()?;
  println!(
    "warm-init ok in {:.1}ms",
    started.elapsed().as_secs_f64() * 1000.0
  );

  let cdp_port: u16 = std::env::var("CEF_REMOTE_DEBUGGING_PORT")
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(9333);

  let _session = app_lib::commands::browser_cef::create_browser_for_spike(parent)?;

  let (tx, rx) = mpsc::channel();
  std::thread::spawn(move || {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut last_err = "not attempted".to_string();
    while Instant::now() < deadline {
      match http_get_localhost(cdp_port, "/json/version") {
        Ok(version) => {
          let list = http_get_localhost(cdp_port, "/json/list").unwrap_or_default();
          let _ = tx.send(Ok((version, list)));
          return;
        }
        Err(error) => {
          last_err = error;
          std::thread::sleep(Duration::from_millis(200));
        }
      }
    }
    let _ = tx.send(Err(last_err));
  });

  println!("probing CDP HTTP while pumping...");
  let mut cdp = None;
  for _ in 0..2500 {
    app_lib::commands::browser_cef::pump_on_main_thread();
    std::thread::sleep(Duration::from_millis(5));
    if let Ok(result) = rx.try_recv() {
      cdp = Some(result);
      break;
    }
  }
  let (version, list) = cdp.ok_or_else(|| "timed out waiting for CDP HTTP".to_string())??;
  println!("CDP /json/version => {}", trim_http_body(&version));
  println!("CDP /json/list => {}", &trim_http_body(&list)[..trim_http_body(&list).len().min(500)]);

  if let Some(ws_url) = extract_ws_url(&version).or_else(|| extract_ws_url(&list)) {
    println!("CDP WS url: {ws_url}");
    let (tx, rx) = mpsc::channel();
    let ws = ws_url.clone();
    std::thread::spawn(move || {
      let _ = tx.send(cdp_target_get_targets(&ws));
    });
    let mut cmd = None;
    for _ in 0..2500 {
      app_lib::commands::browser_cef::pump_on_main_thread();
      std::thread::sleep(Duration::from_millis(5));
      if let Ok(result) = rx.try_recv() {
        cmd = Some(result);
        break;
      }
    }
    let response = cmd.ok_or_else(|| "timed out waiting for CDP WS".to_string())??;
    println!("CDP Target.getTargets => {}", &response[..response.len().min(400)]);
  }

  println!("bench create/destroy x5...");
  let mut create_ms = Vec::new();
  let mut destroy_ms = Vec::new();
  for i in 0..5 {
    app_lib::commands::browser_cef::pump_on_main_thread();
    let started = Instant::now();
    let id = app_lib::commands::browser_cef::create_browser_for_spike(parent)?;
    create_ms.push(started.elapsed().as_secs_f64() * 1000.0);
    println!("  create[{i}] session={id} {:.2}ms", create_ms[i]);

    let started = Instant::now();
    app_lib::commands::browser_cef::destroy_browser_for_spike(&id)?;
    destroy_ms.push(started.elapsed().as_secs_f64() * 1000.0);
    println!("  destroy[{i}] session={id} {:.2}ms", destroy_ms[i]);
  }

  let avg_c = create_ms.iter().sum::<f64>() / create_ms.len() as f64;
  let avg_d = destroy_ms.iter().sum::<f64>() / destroy_ms.len() as f64;
  println!("avg create={avg_c:.2}ms avg destroy={avg_d:.2}ms");
  println!("CEF spike validation PASSED");
  Ok(())
}

#[cfg(target_os = "macos")]
fn trim_http_body(payload: &str) -> &str {
  payload.split("\r\n\r\n").nth(1).unwrap_or(payload).trim()
}

#[cfg(target_os = "macos")]
fn http_get_localhost(port: u16, path: &str) -> Result<String, String> {
  use std::io::{Read, Write};
  use std::net::TcpStream;
  use std::time::Duration;

  let mut stream = TcpStream::connect(("127.0.0.1", port))
    .map_err(|e| format!("TCP connect failed: {e}"))?;
  stream
    .set_read_timeout(Some(Duration::from_secs(2)))
    .map_err(|e| e.to_string())?;
  let request = format!(
    "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
  );
  stream
    .write_all(request.as_bytes())
    .map_err(|e| format!("HTTP write failed: {e}"))?;

  let mut buf = Vec::new();
  let deadline = std::time::Instant::now() + Duration::from_secs(2);
  while std::time::Instant::now() < deadline {
    let mut chunk = [0u8; 4096];
    match stream.read(&mut chunk) {
      Ok(0) => break,
      Ok(n) => buf.extend_from_slice(&chunk[..n]),
      Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
          break;
        }
        std::thread::sleep(Duration::from_millis(20));
      }
      Err(e) => return Err(format!("HTTP read failed: {e}")),
    }
  }
  if buf.is_empty() {
    return Err("empty HTTP response".into());
  }
  Ok(String::from_utf8_lossy(&buf).to_string())
}

#[cfg(target_os = "macos")]
fn extract_ws_url(payload: &str) -> Option<String> {
  let body = trim_http_body(payload);
  if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
    if let Some(url) = value.get("webSocketDebuggerUrl").and_then(|u| u.as_str()) {
      return Some(url.to_string());
    }
    if let Some(arr) = value.as_array() {
      for item in arr {
        if let Some(url) = item.get("webSocketDebuggerUrl").and_then(|u| u.as_str()) {
          return Some(url.to_string());
        }
      }
    }
  }
  None
}

#[cfg(target_os = "macos")]
fn cdp_target_get_targets(ws_url: &str) -> Result<String, String> {
  use base64::Engine;
  use std::io::{Read, Write};
  use std::net::TcpStream;
  use std::time::Duration;

  let url = url::Url::parse(ws_url).map_err(|e| e.to_string())?;
  let host = url.host_str().ok_or("ws url missing host")?;
  let port = url.port().unwrap_or(80);
  let mut path = url.path().to_string();
  if let Some(q) = url.query() {
    path.push('?');
    path.push_str(q);
  }

  let mut stream = TcpStream::connect((host, port)).map_err(|e| e.to_string())?;
  stream
    .set_read_timeout(Some(Duration::from_secs(5)))
    .map_err(|e| e.to_string())?;
  let key = Engine::encode(&base64::engine::general_purpose::STANDARD, b"vixlcefspike1234");
  let handshake = format!(
    "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
  );
  stream.write_all(handshake.as_bytes()).map_err(|e| e.to_string())?;

  let mut header = Vec::new();
  let mut buf = [0u8; 1];
  while !header.windows(4).any(|w| w == b"\r\n\r\n") {
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    if n == 0 {
      break;
    }
    header.push(buf[0]);
  }
  let header_text = String::from_utf8_lossy(&header);
  if !header_text.contains("101") {
    return Err(format!("WS handshake failed: {header_text}"));
  }

  let payload = br#"{"id":1,"method":"Target.getTargets"}"#;
  let mut frame = Vec::new();
  frame.push(0x81);
  frame.push(0x80 | payload.len() as u8);
  let mask = [1u8, 2, 3, 4];
  frame.extend_from_slice(&mask);
  for (i, b) in payload.iter().enumerate() {
    frame.push(b ^ mask[i % 4]);
  }
  stream.write_all(&frame).map_err(|e| e.to_string())?;

  let mut resp = vec![0u8; 65536];
  let n = stream.read(&mut resp).map_err(|e| e.to_string())?;
  if n < 2 {
    return Err("empty WS response".into());
  }
  let mut idx = 1usize;
  let mut len = (resp[idx] & 0x7f) as usize;
  idx += 1;
  if len == 126 {
    len = u16::from_be_bytes([resp[idx], resp[idx + 1]]) as usize;
    idx += 2;
  }
  Ok(String::from_utf8_lossy(&resp[idx..idx + len.min(n - idx)]).to_string())
}
