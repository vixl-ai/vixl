use super::askpass::{secret_kind_is_saveable, AskpassKind, AskpassResponse, SecretKind};

pub const FIXTURE_SSH_PASSWORD: &str = "vixl-fixture-not-a-real-password";

#[derive(Clone, Debug, Default)]
pub struct AuthAttempt {
    saved_password: Option<String>,
    saved_passphrase: Option<String>,
    password_sent: bool,
    passphrase_sent: bool,
    host_key_changed: bool,
    host_key_rejected: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SecretDisposition {
    Submit(String),
    AskUser { saveable: bool },
    Cancel,
}

impl AuthAttempt {
    pub fn new(saved_password: Option<String>, saved_passphrase: Option<String>) -> Self {
        Self {
            saved_password,
            saved_passphrase,
            password_sent: false,
            passphrase_sent: false,
            host_key_changed: false,
            host_key_rejected: false,
        }
    }

    pub fn note_host_key_changed(&mut self) {
        self.host_key_changed = true;
    }

    pub fn note_host_key_rejected(&mut self) {
        self.host_key_rejected = true;
    }

    pub fn host_key_blocked(&self) -> bool {
        self.host_key_changed || self.host_key_rejected
    }

    pub fn take_secret(&mut self, kind: SecretKind) -> SecretDisposition {
        if self.host_key_blocked() {
            return SecretDisposition::Cancel;
        }
        match kind {
            SecretKind::Password => {
                if !self.password_sent {
                    if let Some(value) = self.saved_password.clone() {
                        self.password_sent = true;
                        return SecretDisposition::Submit(value);
                    }
                }
                SecretDisposition::AskUser {
                    saveable: secret_kind_is_saveable(kind),
                }
            }
            SecretKind::Passphrase => {
                if !self.passphrase_sent {
                    if let Some(value) = self.saved_passphrase.clone() {
                        self.passphrase_sent = true;
                        return SecretDisposition::Submit(value);
                    }
                }
                SecretDisposition::AskUser {
                    saveable: secret_kind_is_saveable(kind),
                }
            }
            other => SecretDisposition::AskUser {
                saveable: secret_kind_is_saveable(other),
            },
        }
    }

    pub fn disposition_for(
        &mut self,
        kind: AskpassKind,
        secret_kind: Option<SecretKind>,
        trusted: Option<bool>,
    ) -> AskpassResponse {
        match kind {
            AskpassKind::Confirm => {
                if self.host_key_changed {
                    self.note_host_key_rejected();
                    return AskpassResponse::Cancel;
                }
                match trusted {
                    Some(true) => AskpassResponse::Submit("yes".to_string()),
                    _ => {
                        self.note_host_key_rejected();
                        AskpassResponse::Cancel
                    }
                }
            }
            AskpassKind::Secret => {
                let secret_kind = secret_kind.unwrap_or(SecretKind::Other);
                match self.take_secret(secret_kind) {
                    SecretDisposition::Submit(value) => AskpassResponse::Submit(value),
                    SecretDisposition::Cancel => AskpassResponse::Cancel,
                    SecretDisposition::AskUser { .. } => AskpassResponse::Cancel,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_secret_is_attempted_once() {
        let mut attempt = AuthAttempt::new(Some(FIXTURE_SSH_PASSWORD.to_string()), None);
        match attempt.take_secret(SecretKind::Password) {
            SecretDisposition::Submit(value) => assert_eq!(value, FIXTURE_SSH_PASSWORD),
            other => panic!("expected submit, got {other:?}"),
        }
        match attempt.take_secret(SecretKind::Password) {
            SecretDisposition::AskUser { saveable } => assert!(saveable),
            other => panic!("expected ask user, got {other:?}"),
        }
    }

    #[test]
    fn changed_host_key_does_not_open_password_submission() {
        let mut attempt = AuthAttempt::new(Some(FIXTURE_SSH_PASSWORD.to_string()), None);
        attempt.note_host_key_changed();
        assert_eq!(
            attempt.take_secret(SecretKind::Password),
            SecretDisposition::Cancel
        );
        assert_eq!(
            attempt.take_secret(SecretKind::Passphrase),
            SecretDisposition::Cancel
        );
        assert_eq!(
            attempt.take_secret(SecretKind::Otp),
            SecretDisposition::Cancel
        );
    }

    #[test]
    fn otp_is_not_saveable() {
        let mut attempt = AuthAttempt::new(Some(FIXTURE_SSH_PASSWORD.to_string()), None);
        match attempt.take_secret(SecretKind::Otp) {
            SecretDisposition::AskUser { saveable } => assert!(!saveable),
            other => panic!("expected ask user, got {other:?}"),
        }
    }
}
