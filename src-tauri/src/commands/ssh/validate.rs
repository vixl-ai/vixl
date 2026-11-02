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
    fn port_zero_rejected() {
        assert!(validate_port(Some(0)).is_err());
        assert_eq!(validate_port(Some(22)).expect("22"), Some(22));
    }
}
