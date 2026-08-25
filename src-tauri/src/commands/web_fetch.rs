use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, USER_AGENT};
use serde::{Deserialize, Serialize};

use super::http::validate_proxy_url;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

const CHROME_USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ",
    "AppleWebKit/537.36 (KHTML, like Gecko) ",
    "Chrome/143.0.0.0 Safari/537.36"
);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebFetchFormat {
    #[default]
    Markdown,
    Text,
    Html,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchRequest {
    pub url: String,
    #[serde(default)]
    pub format: WebFetchFormat,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResponse {
    pub status: u16,
    pub body: String,
    pub headers: HashMap<String, String>,
    pub truncated: bool,
}

pub fn accept_header_for_format(format: WebFetchFormat) -> &'static str {
    match format {
    WebFetchFormat::Markdown => {
      "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    }
    WebFetchFormat::Text => {
      "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    }
    WebFetchFormat::Html => {
      "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
    }
  }
}

fn is_binary_content_type(content_type: &str) -> bool {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    mime == "application/pdf" || mime == "application/octet-stream"
}

fn build_request_headers(format: WebFetchFormat) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(CHROME_USER_AGENT));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(accept_header_for_format(format)),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

async fn read_body_capped(response: reqwest::Response) -> Result<Vec<u8>, String> {
    if let Some(content_length) = response.content_length() {
        if content_length as usize > MAX_BODY_BYTES {
            return Err(format!(
                "Response body exceeds {} byte limit",
                MAX_BODY_BYTES
            ));
        }
    }

    let mut stream = response.bytes_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if buf.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
            return Err(format!(
                "Response body exceeds {} byte limit",
                MAX_BODY_BYTES
            ));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

#[tauri::command]
pub async fn web_fetch(request: WebFetchRequest) -> Result<WebFetchResponse, String> {
    validate_proxy_url(&request.url).await?;

    let client = build_client()?;
    let headers = build_request_headers(request.format);
    let response = client
        .get(&request.url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status().as_u16();

    let mut response_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(text) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), text.to_string());
        }
    }

    if let Some(content_type) = response_headers.get("content-type") {
        if is_binary_content_type(content_type) {
            return Err("Response content is binary and cannot be fetched as text".to_string());
        }
    }

    let bytes = read_body_capped(response).await?;
    let body = String::from_utf8(bytes).map_err(|_| {
        "Response content is binary (not valid UTF-8) and cannot be fetched as text".to_string()
    })?;

    Ok(WebFetchResponse {
        status,
        body,
        headers: response_headers,
        truncated: false,
    })
}
