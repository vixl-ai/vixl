use super::errors;

pub fn validate_destination(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(errors::blank_host());
    }
    if looks_like_ssh_command(trimmed) {
        return Err(errors::ssh_command_as_host());
    }
    if looks_like_password_in_host(trimmed) {
        return Err(errors::password_in_host());
    }
    Ok(trimmed.to_string())
}

pub fn validate_port(port: Option<u16>) -> Result<Option<u16>, String> {
    match port {
        None => Ok(None),
        Some(0) => Err(errors::port_not_valid()),
        Some(value) => Ok(Some(value)),
    }
}

pub fn looks_like_ssh_command(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed == "ssh"
        || trimmed.starts_with("ssh ")
        || trimmed.starts_with("ssh\t")
        || trimmed.starts_with("/usr/bin/ssh")
}

pub fn user_from_destination(destination: &str) -> Option<&str> {
    let at = destination.rfind('@')?;
    if at == 0 {
        return None;
    }
    let user = destination[..at].trim();
    if user.is_empty() || user.contains(' ') || user.contains(':') {
        return None;
    }
    Some(user)
}

pub fn resolve_connect_user(requested: Option<&str>, destination: &str) -> Result<String, String> {
    if let Some(user) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(user.to_string());
    }
    if let Some(user) = user_from_destination(destination) {
        return Ok(user.to_string());
    }
    Err(errors::blank_user())
}

pub fn destination_with_user(destination: &str, user: &str) -> String {
    let host = match destination.rfind('@') {
        Some(index) if user_from_destination(destination).is_some() => &destination[index + 1..],
        _ => destination,
    };
    format!("{user}@{host}")
}

pub fn looks_like_password_in_host(value: &str) -> bool {
    let rest = value
        .strip_prefix("ssh://")
        .or_else(|| value.strip_prefix("SSH://"))
        .unwrap_or(value);
    let Some(credentials) = rest.split('@').next() else {
        return false;
    };
    if credentials.starts_with('[') {
        return false;
    }
    credentials.contains(':')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_and_command_and_password() {
        assert!(validate_destination("").is_err());
        assert!(validate_destination("   ").is_err());
        assert!(validate_destination("ssh eva").is_err());
        assert!(validate_destination("ssh -p 22 eva").is_err());
        assert!(validate_destination("aidanhibbard:secret@eva.local").is_err());
        assert!(validate_destination("ssh://aidanhibbard:secret@eva.local").is_err());
        assert_eq!(validate_destination("eva").expect("alias"), "eva");
        assert_eq!(
            validate_destination("aidanhibbard@eva.local").expect("target"),
            "aidanhibbard@eva.local"
        );
    }

    #[test]
    fn connect_user_is_never_the_local_account() {
        let missing = resolve_connect_user(None, "appleseed.example").expect_err("user");
        assert!(missing.contains("Enter a user."));
        assert!(!missing.to_ascii_lowercase().contains("aidan"));
        assert_eq!(
            resolve_connect_user(Some("johnny"), "appleseed.example").expect("typed"),
            "johnny"
        );
        assert_eq!(
            resolve_connect_user(None, "johnny@appleseed.example").expect("in host"),
            "johnny"
        );
        assert_eq!(
            destination_with_user("appleseed.example", "johnny"),
            "johnny@appleseed.example"
        );
        assert_eq!(
            destination_with_user("someone@appleseed.example", "johnny"),
            "johnny@appleseed.example"
        );
    }

    #[test]
    fn port_zero_rejected() {
        assert!(validate_port(Some(0)).is_err());
        assert_eq!(validate_port(Some(22)).expect("22"), Some(22));
    }
}
