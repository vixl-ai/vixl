use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::oneshot;
use url::Url;
use uuid::Uuid;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const BUFFERED_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct HttpStreamRegistry {
    cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl HttpStreamRegistry {
    pub fn register(&self, id: String, tx: oneshot::Sender<()>) {
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(id, tx);
        }
    }

    pub fn take(&self, id: &str) -> Option<oneshot::Sender<()>> {
        self.cancels.lock().ok()?.remove(id)
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(tx) = self.take(id) {
            let _ = tx.send(());
            return true;
        }
        false
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub request_id: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProxyResponse {
    pub status: u16,
    pub body: String,
    pub headers: HashMap<String, String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum HttpProxyStreamEvent {
    Headers {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        bytes: Vec<u8>,
    },
    End,
    Error {
        message: String,
    },
}

fn build_headers(map: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if let Some(map) = map {
        for (key, value) in map {
            let name = HeaderName::from_bytes(key.as_bytes()).map_err(|e| e.to_string())?;
            let val = HeaderValue::from_str(&value).map_err(|e| e.to_string())?;
            headers.insert(name, val);
        }
    }
    Ok(headers)
}

fn build_client(request_timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        // Avoid silent redirect hops to blocked hosts (SSRF).
        .redirect(reqwest::redirect::Policy::none());
    if let Some(timeout) = request_timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().map_err(|e| e.to_string())
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_unspecified() || v4.is_broadcast() || v4.is_link_local() {
                return true;
            }
            // Cloud metadata (AWS/GCP/Azure IMDS and related link-local).
            let octets = v4.octets();
            if octets[0] == 169 && octets[1] == 254 {
                return true;
            }
            false
        }
        IpAddr::V6(v6) => {
            if v6.is_unspecified() || v6.is_unicast_link_local() {
                return true;
            }
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            // IPv4-compatible / embedded forms occasionally used to reach 169.254.x.x
            let segments = v6.segments();
            if segments[0] == 0
                && segments[1] == 0
                && segments[2] == 0
                && segments[3] == 0
                && segments[4] == 0
                && (segments[5] == 0 || segments[5] == 0xffff)
            {
                let v4 = std::net::Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    (segments[6] & 0xff) as u8,
                    (segments[7] >> 8) as u8,
                    (segments[7] & 0xff) as u8,
                );
                return is_blocked_ip(IpAddr::V4(v4));
            }
            false
        }
    }
}

pub fn is_blocked_proxy_host(host: &str) -> bool {
    let trimmed = host.trim().trim_matches(|c| c == '[' || c == ']');
    if trimmed.is_empty() {
        return true;
    }

    let lower = trimmed.to_ascii_lowercase();
    const BLOCKED_HOSTS: &[&str] = &[
        "0.0.0.0",
        "169.254.169.254",
        "metadata.google.internal",
        "metadata.goog",
        "instance-data",
    ];
    if BLOCKED_HOSTS.contains(&lower.as_str()) || lower.ends_with(".metadata.google.internal") {
        return true;
    }

    if let Ok(ip) = trimmed.parse::<IpAddr>() {
        return is_blocked_ip(ip);
    }

    if lower.starts_with("fe80:") || lower.starts_with("169.254.") {
        return true;
    }

    false
}

pub async fn validate_proxy_url(raw: &str) -> Result<(), String> {
    let parsed = Url::parse(raw).map_err(|error| format!("Invalid URL: {error}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("URL scheme '{scheme}' is not allowed"));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL host is required".to_string())?;
    if host.trim().is_empty() {
        return Err("URL host is required".to_string());
    }
    if is_blocked_proxy_host(host) {
        return Err("URL host is not allowed".to_string());
    }

    // Resolve and reject link-local / metadata addresses. Loopback and RFC1918 stay
    // allowed so local model endpoints (Ollama, etc.) keep working.
    let port = parsed.port_or_known_default().unwrap_or(80);
    let lookup = format!("{host}:{port}");
    match tokio::net::lookup_host(&lookup).await {
        Ok(addrs) => {
            for addr in addrs {
                if is_blocked_ip(addr.ip()) {
                    return Err("URL host resolves to a blocked address".to_string());
                }
            }
        }
        Err(error) => {
            return Err(format!("Failed to resolve URL host: {error}"));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn http_proxy_request(
    request: HttpProxyRequest,
    registry: State<'_, HttpStreamRegistry>,
) -> Result<HttpProxyResponse, String> {
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    registry.register(request_id.clone(), cancel_tx);

    let result = run_proxy_request(request, &mut cancel_rx).await;
    registry.take(&request_id);
    result
}

async fn run_proxy_request(
    request: HttpProxyRequest,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> Result<HttpProxyResponse, String> {
    validate_proxy_url(&request.url).await?;
    let client = build_client(Some(BUFFERED_REQUEST_TIMEOUT))?;
    let method =
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
    let headers = build_headers(request.headers)?;

    let mut builder = client.request(method, &request.url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = tokio::select! {
      response = builder.send() => response.map_err(|e| e.to_string())?,
      _ = &mut *cancel_rx => {
        return Err("Request aborted".to_string());
      }
    };
    let status = response.status().as_u16();

    let mut response_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(text) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), text.to_string());
        }
    }

    let body = tokio::select! {
      body = response.text() => body.map_err(|e| e.to_string())?,
      _ = &mut *cancel_rx => {
        return Err("Request aborted".to_string());
      }
    };

    Ok(HttpProxyResponse {
        status,
        body,
        headers: response_headers,
    })
}

#[tauri::command]
pub async fn http_proxy_stream(
    request: HttpProxyRequest,
    on_event: Channel<HttpProxyStreamEvent>,
    registry: State<'_, HttpStreamRegistry>,
) -> Result<(), String> {
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    registry.register(request_id.clone(), cancel_tx);

    let result = run_proxy_stream(request, on_event, &mut cancel_rx).await;
    registry.take(&request_id);
    result
}

#[tauri::command]
pub fn http_proxy_stream_cancel(
    request_id: String,
    registry: State<'_, HttpStreamRegistry>,
) -> Result<(), String> {
    let _ = registry.cancel(&request_id);
    Ok(())
}

async fn run_proxy_stream(
    request: HttpProxyRequest,
    on_event: Channel<HttpProxyStreamEvent>,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> Result<(), String> {
    validate_proxy_url(&request.url).await?;
    // No overall request timeout: streams can run for a long time once connected.
    let client = build_client(None)?;
    let method =
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
    let headers = build_headers(request.headers)?;

    let mut builder = client.request(method, &request.url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = tokio::select! {
      response = builder.send() => response.map_err(|e| e.to_string())?,
      _ = &mut *cancel_rx => {
        let _ = on_event.send(HttpProxyStreamEvent::Error {
          message: "Request aborted".to_string(),
        });
        return Ok(());
      }
    };
    let status = response.status().as_u16();

    let mut response_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(text) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), text.to_string());
        }
    }

    if on_event
        .send(HttpProxyStreamEvent::Headers {
            status,
            headers: response_headers,
        })
        .is_err()
    {
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    loop {
        tokio::select! {
          chunk = stream.next() => {
            match chunk {
              Some(Ok(bytes)) => {
                if bytes.is_empty() {
                  continue;
                }
                if on_event
                  .send(HttpProxyStreamEvent::Chunk {
                    bytes: bytes.to_vec(),
                  })
                  .is_err()
                {
                  break;
                }
              }
              Some(Err(error)) => {
                let _ = on_event.send(HttpProxyStreamEvent::Error {
                  message: error.to_string(),
                });
                return Err(error.to_string());
              }
              None => break,
            }
          }
          _ = &mut *cancel_rx => {
            let _ = on_event.send(HttpProxyStreamEvent::Error {
              message: "Request aborted".to_string(),
            });
            // Dropping `stream` / `response` aborts the upstream HTTP body.
            return Ok(());
          }
        }
    }

    let _ = on_event.send(HttpProxyStreamEvent::End);
    Ok(())
}
