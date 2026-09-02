use serde::Serialize;
use url::Url;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCallbackPayload {
    pub code: String,
    pub state: String,
    pub iss: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
    pub error_uri: Option<String>,
    pub flow_id: String,
}

impl OAuthCallbackPayload {
    pub fn with_flow_id(mut self, flow_id: String) -> Self {
        self.flow_id = flow_id;
        self
    }

    pub fn protocol_error(message: String, flow_id: String) -> Self {
        Self {
            error: Some(message),
            flow_id,
            ..Self::default()
        }
    }
}

pub fn parse_callback_request(
    request: &str,
    expected_port: u16,
) -> Result<OAuthCallbackPayload, String> {
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "Empty OAuth callback request".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "Malformed OAuth callback request".to_string())?;
    let path = parts
        .next()
        .ok_or_else(|| "Malformed OAuth callback request".to_string())?;

    if !method.eq_ignore_ascii_case("GET") {
        return Err("OAuth callback must be GET".to_string());
    }

    let url = Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|error| format!("Invalid OAuth callback path: {error}"))?;

    if url.path() != "/callback" {
        return Err("OAuth callback path must be /callback".to_string());
    }

    let host =
        request_host(request).ok_or_else(|| "OAuth callback Host must be 127.0.0.1".to_string())?;
    if !is_allowed_loopback_host(&host, expected_port) {
        return Err("OAuth callback Host must be 127.0.0.1".to_string());
    }

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut iss: Option<String> = None;
    let mut oauth_error: Option<String> = None;
    let mut error_description: Option<String> = None;
    let mut error_uri: Option<String> = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "iss" => iss = Some(value.into_owned()),
            "error" => oauth_error = Some(value.into_owned()),
            "error_description" => error_description = Some(value.into_owned()),
            "error_uri" => error_uri = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(error) = oauth_error.filter(|value| !value.is_empty()) {
        return Ok(OAuthCallbackPayload {
            code: nonempty_or_empty(code),
            state: nonempty_or_empty(state),
            iss: nonempty_option(iss),
            error: Some(error),
            error_description: nonempty_option(error_description),
            error_uri: nonempty_option(error_uri),
            flow_id: String::new(),
        });
    }

    let code = nonempty_option(code).ok_or_else(|| "OAuth callback missing code".to_string())?;
    let state = nonempty_option(state).ok_or_else(|| "OAuth callback missing state".to_string())?;
    Ok(OAuthCallbackPayload {
        code,
        state,
        iss: nonempty_option(iss),
        error: None,
        error_description: None,
        error_uri: None,
        flow_id: String::new(),
    })
}

fn request_host(request: &str) -> Option<String> {
    for line in request.lines().skip(1) {
        if line.trim().is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("host") {
            return Some(value.trim().to_string());
        }
    }
    None
}

fn is_allowed_loopback_host(host: &str, port: u16) -> bool {
    host.eq_ignore_ascii_case("127.0.0.1")
        || host.eq_ignore_ascii_case(&format!("127.0.0.1:{port}"))
}

fn nonempty_option(value: Option<String>) -> Option<String> {
    value.filter(|item| !item.is_empty())
}

fn nonempty_or_empty(value: Option<String>) -> String {
    nonempty_option(value).unwrap_or_default()
}
