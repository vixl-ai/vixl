use url::Url;

#[tauri::command]
pub fn open_external_url(url: String, allowed_origin: Option<String>) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
    let scheme = parsed.scheme();
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    let is_loopback = host == "localhost" || host == "127.0.0.1" || host == "::1";

    if scheme == "http" {
        if !is_loopback {
            return Err("http URLs may only be opened for localhost".to_string());
        }
    } else if scheme != "https" {
        return Err("Only https URLs can be opened (or http localhost)".to_string());
    }

    let Some(allowed) = allowed_origin.filter(|value| !value.trim().is_empty()) else {
        return Err("allowed_origin is required to open external URLs".to_string());
    };

    let allowed_parsed =
        Url::parse(&allowed).map_err(|error| format!("Invalid allowed origin: {error}"))?;
    if parsed.origin() != allowed_parsed.origin() {
        return Err(format!(
            "URL origin {} does not match allowed origin {}",
            parsed.origin().ascii_serialization(),
            allowed_parsed.origin().ascii_serialization()
        ));
    }

    open::that_detached(url).map_err(|error| error.to_string())
}
