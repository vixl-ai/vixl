use app_lib::commands::oauth::parse_callback_request;

const PORT: u16 = 34567;

fn request(method: &str, path: &str, host: Option<&str>) -> String {
    match host {
        Some(host) => format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\n\r\n"),
        None => format!("{method} {path} HTTP/1.1\r\n\r\n"),
    }
}

#[test]
fn parse_success_code_state_iss() {
    let raw = request(
        "GET",
        "/callback?code=splendid&state=xyz&iss=https%3A%2F%2Fauth.example",
        Some("127.0.0.1:34567"),
    );
    let parsed = parse_callback_request(&raw, PORT).expect("callback should parse");
    assert_eq!(parsed.code, "splendid");
    assert_eq!(parsed.state, "xyz");
    assert_eq!(parsed.iss.as_deref(), Some("https://auth.example"));
    assert_eq!(parsed.error, None);
    assert_eq!(parsed.error_description, None);
    assert_eq!(parsed.error_uri, None);
}

#[test]
fn parse_oauth_error() {
    let raw = request(
        "GET",
        "/callback?error=access_denied&error_description=User%20denied&error_uri=https%3A%2F%2Fex.example%2Fe&state=xyz",
        Some("127.0.0.1:34567"),
    );
    let parsed = parse_callback_request(&raw, PORT).expect("oauth error should parse");
    assert_eq!(parsed.code, "");
    assert_eq!(parsed.state, "xyz");
    assert_eq!(parsed.error.as_deref(), Some("access_denied"));
    assert_eq!(parsed.error_description.as_deref(), Some("User denied"));
    assert_eq!(parsed.error_uri.as_deref(), Some("https://ex.example/e"));
}

#[test]
fn parse_missing_code() {
    let raw = request("GET", "/callback?state=xyz", Some("127.0.0.1:34567"));
    let error = parse_callback_request(&raw, PORT).expect_err("missing code should fail");
    assert_eq!(error, "OAuth callback missing code");
}

#[test]
fn parse_missing_state() {
    let raw = request("GET", "/callback?code=splendid", Some("127.0.0.1:34567"));
    let error = parse_callback_request(&raw, PORT).expect_err("missing state should fail");
    assert_eq!(error, "OAuth callback missing state");
}

#[test]
fn parse_iss_passthrough_on_oauth_error() {
    let raw = request(
        "GET",
        "/callback?error=access_denied&error_description=User%20denied&state=xyz&iss=https%3A%2F%2Fauth.example",
        Some("127.0.0.1:34567"),
    );
    let parsed = parse_callback_request(&raw, PORT).expect("iss should pass through");
    assert_eq!(parsed.error.as_deref(), Some("access_denied"));
    assert_eq!(parsed.error_description.as_deref(), Some("User denied"));
    assert_eq!(parsed.iss.as_deref(), Some("https://auth.example"));
    assert_eq!(parsed.state, "xyz");
}

#[test]
fn parse_rejects_wrong_host() {
    let wrong_port = request(
        "GET",
        "/callback?code=splendid&state=xyz",
        Some("127.0.0.1:11111"),
    );
    let error = parse_callback_request(&wrong_port, PORT).expect_err("wrong port should fail");
    assert_eq!(error, "OAuth callback Host must be 127.0.0.1");

    let missing = request("GET", "/callback?code=splendid&state=xyz", None);
    let error = parse_callback_request(&missing, PORT).expect_err("missing Host should fail");
    assert_eq!(error, "OAuth callback Host must be 127.0.0.1");
}

#[test]
fn parse_rejects_localhost_host() {
    let raw = request(
        "GET",
        "/callback?code=splendid&state=xyz",
        Some("localhost:34567"),
    );
    let error = parse_callback_request(&raw, PORT).expect_err("localhost Host should fail");
    assert_eq!(error, "OAuth callback Host must be 127.0.0.1");
}

#[test]
fn parse_accepts_host_without_port() {
    let raw = request(
        "GET",
        "/callback?code=splendid&state=xyz",
        Some("127.0.0.1"),
    );
    let parsed = parse_callback_request(&raw, PORT).expect("Host without port should parse");
    assert_eq!(parsed.code, "splendid");
    assert_eq!(parsed.state, "xyz");
}

#[test]
fn parse_rejects_wrong_path() {
    let raw = request("GET", "/?code=splendid&state=xyz", Some("127.0.0.1:34567"));
    let error = parse_callback_request(&raw, PORT).expect_err("wrong path should fail");
    assert_eq!(error, "OAuth callback path must be /callback");
}

#[test]
fn parse_rejects_non_get() {
    let raw = request(
        "POST",
        "/callback?code=splendid&state=xyz",
        Some("127.0.0.1:34567"),
    );
    let error = parse_callback_request(&raw, PORT).expect_err("non-GET should fail");
    assert_eq!(error, "OAuth callback must be GET");
}
