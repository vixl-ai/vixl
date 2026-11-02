#[cfg(test)]
use std::io::Read;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    Passphrase,
    Password,
    Otp,
    Pin,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AskpassKind {
    Confirm,
    Secret,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AskpassResponse {
    Submit(String),
    Cancel,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AskpassRequest {
    pub kind: AskpassKind,
    pub prompt: String,
    pub secret_kind: Option<SecretKind>,
}

pub fn prompt_is_host_confirm(prompt: &str) -> bool {
    let lower = prompt.to_ascii_lowercase();
    lower.contains("are you sure you want to continue connecting")
        || lower.contains("please type 'yes'")
        || lower.contains("authenticity of host")
}

pub fn classify_askpass(prompt_env: Option<&str>, prompt: &str) -> AskpassRequest {
    let hinted_confirm = prompt_env
        .map(|value| value.eq_ignore_ascii_case("confirm"))
        .unwrap_or(false);
    if hinted_confirm || prompt_is_host_confirm(prompt) {
        return AskpassRequest {
            kind: AskpassKind::Confirm,
            prompt: prompt.to_string(),
            secret_kind: None,
        };
    }
    AskpassRequest {
        kind: AskpassKind::Secret,
        prompt: prompt.to_string(),
        secret_kind: Some(classify_secret_kind(prompt)),
    }
}

pub fn classify_secret_kind(prompt: &str) -> SecretKind {
    let lower = prompt.to_ascii_lowercase();
    if lower.contains("passphrase") {
        SecretKind::Passphrase
    } else if lower.contains("verification code")
        || lower.contains("one-time")
        || lower.contains("authentication code")
        || lower.contains("otp")
    {
        SecretKind::Otp
    } else if lower.contains("pin") {
        SecretKind::Pin
    } else if lower.contains("password") {
        SecretKind::Password
    } else {
        SecretKind::Other
    }
}

pub fn secret_kind_is_saveable(kind: SecretKind) -> bool {
    matches!(kind, SecretKind::Password | SecretKind::Passphrase)
}

pub fn encode_helper_stdio(response: &AskpassResponse) -> (i32, Vec<u8>) {
    match response {
        AskpassResponse::Submit(value) => {
            let mut bytes = value.as_bytes().to_vec();
            if !bytes.ends_with(b"\n") {
                bytes.push(b'\n');
            }
            (0, bytes)
        }
        AskpassResponse::Cancel => (1, Vec::new()),
    }
}

#[cfg(test)]
pub fn write_lp(writer: &mut impl Write, value: &str) -> std::io::Result<()> {
    let bytes = value.as_bytes();
    writer.write_all(&(bytes.len() as u32).to_be_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
pub fn read_lp(reader: &mut impl Read) -> std::io::Result<String> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf)?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 64 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "askpass payload too large",
        ));
    }
    let mut buf = vec![0u8; len];
    if len > 0 {
        reader.read_exact(&mut buf)?;
    }
    String::from_utf8(buf).map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
}

#[cfg(test)]
pub fn write_askpass_response(
    writer: &mut impl Write,
    response: &AskpassResponse,
) -> std::io::Result<()> {
    match response {
        AskpassResponse::Submit(value) => {
            write_lp(writer, "ok")?;
            write_lp(writer, value)
        }
        AskpassResponse::Cancel => {
            write_lp(writer, "cancel")?;
            write_lp(writer, "")
        }
    }
}

#[cfg(test)]
pub fn read_askpass_response(reader: &mut impl Read) -> std::io::Result<AskpassResponse> {
    let status = read_lp(reader)?;
    let value = read_lp(reader)?;
    if status == "ok" {
        Ok(AskpassResponse::Submit(value))
    } else {
        Ok(AskpassResponse::Cancel)
    }
}

const ASKPASS_PERL: &str = r#"#!/usr/bin/perl
use strict;
use warnings;
use IO::Socket::UNIX;

my $prompt = defined $ARGV[0] ? $ARGV[0] : '';
my $kind = defined $ENV{SSH_ASKPASS_PROMPT} ? $ENV{SSH_ASKPASS_PROMPT} : '';
my $path = $ENV{VIXL_SSH_ASKPASS_SOCK};
exit 1 unless defined $path && length $path;

my $sock = IO::Socket::UNIX->new(Peer => $path, Type => SOCK_STREAM()) or exit 1;
$sock->autoflush(1);

sub wr {
  my ($s, $buf) = @_;
  my $n = pack('N', length($buf));
  print $s $n, $buf;
}
sub rd {
  my ($s) = @_;
  my $lenb = '';
  return undef unless read($s, $lenb, 4) == 4;
  my $len = unpack('N', $lenb);
  return '' if $len == 0;
  my $buf = '';
  return undef unless read($s, $buf, $len) == $len;
  return $buf;
}

wr($sock, $kind);
wr($sock, $prompt);
my $status = rd($sock);
my $value = rd($sock);
if (defined $status && $status eq 'ok') {
  if (defined $value && length $value) {
    print $value;
    print "\n" unless $value =~ /\n\z/;
  } else {
    print "\n";
  }
  exit 0;
}
exit 1;
"#;

#[cfg(unix)]
pub fn write_askpass_helper(dest: &Path) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::fs::PermissionsExt;

    if let Some(parent) = dest.parent() {
        super::paths::ensure_dir_mode_0700(parent)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true).mode(0o700);
    let mut file = opts
        .open(dest)
        .map_err(|err| format!("Could not write askpass helper: {err}"))?;
    file.write_all(ASKPASS_PERL.as_bytes())
        .map_err(|err| format!("Could not write askpass helper: {err}"))?;
    file.sync_all()
        .map_err(|err| format!("Could not sync askpass helper: {err}"))?;
    drop(file);
    std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o700))
        .map_err(|err| format!("Could not set askpass helper mode: {err}"))?;
    Ok(())
}

#[cfg(unix)]
pub fn require_helper_mode_0700(path: &Path, hostname: &str) -> Result<(), String> {
    let mode = super::paths::file_mode(path)?;
    if mode != 0o700 {
        return Err(super::errors::askpass_not_private(
            hostname,
            mode,
            &path.to_string_lossy(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn confirm_vs_secret_classification() {
        let confirm = classify_askpass(
            Some("confirm"),
            "Are you sure you want to continue connecting (yes/no/[fingerprint])?",
        );
        assert_eq!(confirm.kind, AskpassKind::Confirm);
        assert_eq!(confirm.secret_kind, None);

        let host = classify_askpass(
            None,
            "The authenticity of host 'appleseed.example' can't be established.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?",
        );
        assert_eq!(host.kind, AskpassKind::Confirm);
        assert_eq!(host.secret_kind, None);
        let again = classify_askpass(Some("none"), "Please type 'yes' or 'no': ");
        assert_eq!(again.kind, AskpassKind::Confirm);

        let password = classify_askpass(None, "johnny@appleseed.example's password:");
        assert_eq!(password.kind, AskpassKind::Secret);
        assert_eq!(password.secret_kind, Some(SecretKind::Password));

        let pass = classify_askpass(Some("entry"), "Enter passphrase for key '/tmp/id_ed25519':");
        assert_eq!(pass.secret_kind, Some(SecretKind::Passphrase));

        let otp = classify_askpass(None, "Verification code:");
        assert_eq!(otp.secret_kind, Some(SecretKind::Otp));
        assert!(!secret_kind_is_saveable(SecretKind::Otp));
        assert!(!secret_kind_is_saveable(SecretKind::Pin));
        assert!(secret_kind_is_saveable(SecretKind::Password));
    }

    #[test]
    fn cancel_does_not_produce_password() {
        let (code, stdout) = encode_helper_stdio(&AskpassResponse::Cancel);
        assert_eq!(code, 1);
        assert!(stdout.is_empty());

        let (code, stdout) = encode_helper_stdio(&AskpassResponse::Submit(String::new()));
        assert_eq!(code, 0);
        assert_eq!(stdout, b"\n");
    }

    #[test]
    fn protocol_round_trip_empty_and_cancel() {
        let mut buf = Cursor::new(Vec::new());
        write_askpass_response(&mut buf, &AskpassResponse::Cancel).expect("write");
        buf.set_position(0);
        let parsed = read_askpass_response(&mut buf).expect("read");
        assert_eq!(parsed, AskpassResponse::Cancel);

        let mut buf = Cursor::new(Vec::new());
        write_askpass_response(&mut buf, &AskpassResponse::Submit(String::new())).expect("write");
        buf.set_position(0);
        let parsed = read_askpass_response(&mut buf).expect("read");
        assert_eq!(parsed, AskpassResponse::Submit(String::new()));
    }

    #[cfg(unix)]
    #[test]
    fn helper_file_is_0700() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("askpass");
        write_askpass_helper(&path).expect("write");
        require_helper_mode_0700(&path, "eva.local").expect("0700");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).expect("chmod");
        let err = require_helper_mode_0700(&path, "eva.local").unwrap_err();
        assert!(err.contains("The askpass helper for eva.local is not private"));
        assert!(err.contains("644") || err.contains("mode 644"));
    }
}
