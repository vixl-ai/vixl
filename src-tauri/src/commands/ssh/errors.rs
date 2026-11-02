use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshErrorCopy {
    pub title: String,
    pub body: String,
}

impl SshErrorCopy {
    pub fn new(title: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            body: body.into(),
        }
    }

    pub fn into_message(self) -> String {
        format!("{}\n{}", self.title, self.body)
    }
}

pub fn blank_host() -> String {
    SshErrorCopy::new(
        "Enter a host.",
        "Type an alias such as eva, or a user and host such as aidanhibbard@eva.local.",
    )
    .into_message()
}

pub fn password_in_host() -> String {
    SshErrorCopy::new(
        "Remove the password from the host field.",
        "Vixl will not connect with a password in the host. Type eva, or aidanhibbard@eva.local, and enter the password when asked.",
    )
    .into_message()
}

pub fn ssh_command_as_host() -> String {
    SshErrorCopy::new(
        "That is an ssh command, not a host.",
        "Vixl connects to a host such as eva. Flags in this field are not applied. Set the port and the identity file in the fields below. The next screen shows the settings OpenSSH will use.",
    )
    .into_message()
}

pub fn port_not_valid() -> String {
    SshErrorCopy::new("Port is not valid.", "Use a number from 1 to 65535.").into_message()
}

pub fn ssh_missing(hostname: &str, os_error: &str) -> String {
    SshErrorCopy::new(
        format!("Could not run /usr/bin/ssh for {hostname}."),
        os_error.to_string(),
    )
    .into_message()
}

pub fn socket_path_too_long(hostname: &str, n: usize) -> String {
    SshErrorCopy::new(
        format!("SSH socket path is too long for {hostname}."),
        format!("The socket path is {n} bytes. macOS allows 103. Vixl did not connect."),
    )
    .into_message()
}

pub fn askpass_not_private(hostname: &str, mode: u32, path: &str) -> String {
    SshErrorCopy::new(
        format!("The askpass helper for {hostname} is not private."),
        format!("It must be mode 0700. It is mode {mode:o} at {path}. Vixl did not connect."),
    )
    .into_message()
}

pub fn already_connected(hostname: &str) -> String {
    format!("{hostname} is already connected.")
}

pub fn cancelled_copy(hostname: &str) -> SshErrorCopy {
    SshErrorCopy::new(
        format!("Connection to {hostname} cancelled."),
        "Vixl stopped the connection before it finished.",
    )
}

pub fn connect_failure_copy(hostname: &str, stderr: &str, user_cancelled: bool) -> SshErrorCopy {
    if user_cancelled {
        return cancelled_copy(hostname);
    }
    if stderr.trim().is_empty() {
        return SshErrorCopy::new(
            format!("Could not connect to {hostname}."),
            "The SSH master did not come up.",
        );
    }
    classify_master_failure(hostname, stderr)
}

pub fn not_connected(hostname: &str) -> String {
    format!("{hostname} is not connected")
}

pub fn dead_master_channel(hostname: &str) -> String {
    format!("{hostname} is not connected. The SSH master is dead. This channel was not opened.")
}

pub fn preview_failed(destination: &str, ssh_error: &str) -> String {
    SshErrorCopy::new(
        format!("Could not read SSH settings for {destination}."),
        ssh_error.to_string(),
    )
    .into_message()
}

pub fn classify_master_failure(hostname: &str, stderr: &str) -> SshErrorCopy {
    let lower = stderr.to_ascii_lowercase();
    if looks_like_host_key_changed(stderr) {
        return SshErrorCopy::new(
            format!("Host key for {hostname} changed."),
            host_key_changed_body(hostname, stderr),
        );
    }
    if lower.contains("host key verification failed") {
        return SshErrorCopy::new(
            format!("You rejected the host key for {hostname}."),
            format!("Host key verification failed. {stderr}"),
        );
    }
    if lower.contains("could not resolve hostname") || lower.contains("nodename nor servname") {
        return SshErrorCopy::new(
            format!("Could not resolve {hostname}."),
            stderr.trim().to_string(),
        );
    }
    if lower.contains("connection refused") {
        return SshErrorCopy::new(
            format!("{hostname} refused the connection."),
            stderr.trim().to_string(),
        );
    }
    if lower.contains("operation timed out") || lower.contains("connection timed out") {
        return SshErrorCopy::new(format!("{hostname} timed out."), stderr.trim().to_string());
    }
    if lower.contains("no route to host") || lower.contains("network is unreachable") {
        return SshErrorCopy::new(
            format!("Could not reach {hostname}."),
            stderr.trim().to_string(),
        );
    }
    if lower.contains("too many authentication failures") {
        return SshErrorCopy::new(
            format!("Too many authentication failures for {hostname}."),
            stderr.trim().to_string(),
        );
    }
    if lower.contains("permission denied") || lower.contains("no more authentication methods") {
        return SshErrorCopy::new(
            format!("Authentication failed for that user at {hostname}."),
            stderr.trim().to_string(),
        );
    }
    if lower.contains("controlpath too long") {
        return SshErrorCopy::new(
            format!("Could not connect to {hostname}."),
            stderr.trim().to_string(),
        );
    }
    SshErrorCopy::new(
        format!("Could not connect to {hostname}."),
        stderr.trim().to_string(),
    )
}

pub fn looks_like_host_key_changed(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("remote host identification has changed")
        || (lower.contains("host key verification failed") && lower.contains("offending"))
}

fn host_key_changed_body(hostname: &str, stderr: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        format!("OpenSSH refused the connection. The key from {hostname} does not match the stored key. Keyboard login and the password were not tried.")
    } else {
        format!("{trimmed} Keyboard login and the password were not tried.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_key_classifier() {
        let text =
            "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed.";
        assert!(looks_like_host_key_changed(text));
        let copy = classify_master_failure("eva.local", text);
        assert_eq!(copy.title, "Host key for eva.local changed.");
        assert!(copy.body.contains("password were not tried"));
    }

    #[test]
    fn connection_refused_is_not_rewritten_as_cancelled() {
        let stderr = "ssh: connect to host eva.local port 22: Connection refused";
        let copy = connect_failure_copy("eva.local", stderr, false);
        assert_eq!(copy.title, "eva.local refused the connection.");
        assert!(copy.body.contains("Connection refused"));
        assert!(
            !copy.title.to_ascii_lowercase().contains("cancelled"),
            "refused stderr must keep classify_master_failure, got {}",
            copy.title
        );
        let cancelled = connect_failure_copy("eva.local", stderr, true);
        assert_eq!(cancelled.title, "Connection to eva.local cancelled.");
    }
}
