use super::paths::{quote_ssh_value, SSH_BIN};

pub const PIN_OPTIONS: &[&str] = &[
    "ForwardAgent=no",
    "ForwardX11=no",
    "ForwardX11Trusted=no",
    "Tunnel=no",
    "GatewayPorts=no",
    "PermitLocalCommand=no",
    "ClearAllForwardings=yes",
    "UpdateHostKeys=no",
    "StrictHostKeyChecking=ask",
    "ServerAliveInterval=15",
    "ServerAliveCountMax=3",
    "ControlPersist=no",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ControlMasterMode {
    Yes,
    No,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TtyMode {
    No,
    Force,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SshInvocation {
    Preview,
    Master,
    Exec { command: String },
    Sftp,
    Tty { command: Option<String> },
    ControlCheck,
    ControlExit,
    ControlForward { spec: String },
}

#[derive(Clone, Debug)]
pub struct SshArgv {
    pub program: &'static str,
    pub args: Vec<String>,
}

impl SshArgv {
    pub fn as_command_line(&self) -> Vec<String> {
        let mut out = Vec::with_capacity(self.args.len() + 1);
        out.push(self.program.to_string());
        out.extend(self.args.iter().cloned());
        out
    }
}

#[derive(Clone, Debug)]
pub struct ArgvRequest<'a> {
    pub destination: &'a str,
    pub control_path: Option<&'a str>,
    pub control_master: ControlMasterMode,
    pub tty: TtyMode,
    pub vixl_known_hosts: &'a str,
    pub user_known_hosts: &'a str,
    pub password_only: bool,
    pub port: Option<u16>,
    pub identity_file: Option<&'a str>,
    pub invocation: SshInvocation,
    pub config_file: Option<&'a str>,
}

pub fn build_ssh_argv(request: ArgvRequest<'_>) -> SshArgv {
    let mut args = Vec::new();

    if let SshInvocation::Preview = request.invocation {
        args.push("-G".to_string());
    }

    if let Some(config) = request.config_file {
        args.push("-F".to_string());
        args.push(config.to_string());
    }

    match request.invocation {
        SshInvocation::Master => {
            args.push("-N".to_string());
            args.push("-T".to_string());
        }
        SshInvocation::Tty { .. } => {
            args.push("-tt".to_string());
        }
        SshInvocation::Sftp => {
            args.push("-s".to_string());
        }
        SshInvocation::ControlCheck => {
            args.push("-O".to_string());
            args.push("check".to_string());
        }
        SshInvocation::ControlExit => {
            args.push("-O".to_string());
            args.push("exit".to_string());
        }
        SshInvocation::ControlForward { ref spec } => {
            args.push("-O".to_string());
            args.push("forward".to_string());
            args.push("-L".to_string());
            args.push(spec.clone());
        }
        SshInvocation::Preview | SshInvocation::Exec { .. } => {}
    }

    if !matches!(request.invocation, SshInvocation::Preview) {
        if let Some(control_path) = request.control_path {
            let master = match request.control_master {
                ControlMasterMode::Yes => "yes",
                ControlMasterMode::No => "no",
            };
            args.push("-o".to_string());
            args.push(format!("ControlMaster={master}"));
            args.push("-o".to_string());
            args.push(format!("ControlPath={}", quote_ssh_value(control_path)));
        }
    }

    for pin in PIN_OPTIONS {
        if matches!(request.invocation, SshInvocation::ControlForward { .. })
            && *pin == "ClearAllForwardings=yes"
        {
            continue;
        }
        args.push("-o".to_string());
        args.push((*pin).to_string());
    }

    let request_tty = match request.tty {
        TtyMode::No => "no",
        TtyMode::Force => "yes",
    };
    args.push("-o".to_string());
    args.push(format!("RequestTTY={request_tty}"));

    args.push("-o".to_string());
    args.push(format!(
        "UserKnownHostsFile={} {}",
        quote_ssh_value(request.vixl_known_hosts),
        quote_ssh_value(request.user_known_hosts)
    ));

    if request.password_only {
        args.push("-o".to_string());
        args.push("PubkeyAuthentication=no".to_string());
    }

    if let Some(port) = request.port {
        args.push("-p".to_string());
        args.push(port.to_string());
    }

    if let Some(identity) = request.identity_file {
        args.push("-i".to_string());
        args.push(identity.to_string());
        args.push("-o".to_string());
        args.push("IdentitiesOnly=yes".to_string());
    }

    args.push(request.destination.to_string());

    if let SshInvocation::Exec { command } = &request.invocation {
        args.push("--".to_string());
        args.push(command.clone());
    }
    if let SshInvocation::Tty {
        command: Some(command),
    } = &request.invocation
    {
        args.push("--".to_string());
        args.push(command.clone());
    }
    if let SshInvocation::Sftp = &request.invocation {
        args.push("sftp".to_string());
    }

    SshArgv {
        program: SSH_BIN,
        args,
    }
}

pub fn argv_contains_forbidden(args: &[String]) -> bool {
    args.iter().any(|arg| {
        arg == "-A"
            || arg == "StrictHostKeyChecking=no"
            || arg == "StrictHostKeyChecking=accept-new"
            || arg.contains("UserKnownHostsFile=/dev/null")
            || arg == "-f"
            || arg.contains("ControlPersist=yes")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(invocation: SshInvocation, password_only: bool, tty: TtyMode) -> SshArgv {
        build_ssh_argv(ArgvRequest {
            destination: "eva",
            control_path: Some("/tmp/vixl-test/cm/abcd"),
            control_master: match invocation {
                SshInvocation::Master => ControlMasterMode::Yes,
                _ => ControlMasterMode::No,
            },
            tty,
            vixl_known_hosts: "/tmp/vixl-test/known_hosts",
            user_known_hosts: "/tmp/user-ssh/known_hosts",
            password_only,
            port: Some(22),
            identity_file: None,
            invocation,
            config_file: None,
        })
    }

    #[test]
    fn master_argv_contains_pins_and_not_forbidden() {
        let argv = sample(SshInvocation::Master, false, TtyMode::No);
        let joined = argv.as_command_line().join(" ");
        assert_eq!(argv.program, SSH_BIN);
        for pin in PIN_OPTIONS {
            assert!(joined.contains(pin), "missing pin {pin}");
        }
        assert!(joined.contains("RequestTTY=no"));
        assert!(joined.contains("ControlMaster=yes"));
        assert!(joined.contains("-N"));
        assert!(joined.contains("-T"));
        assert!(joined.contains("StrictHostKeyChecking=ask"));
        assert!(joined
            .contains("UserKnownHostsFile=/tmp/vixl-test/known_hosts /tmp/user-ssh/known_hosts"));
        assert!(!joined.contains("-A"));
        assert!(!joined.contains("ControlPersist=yes"));
        assert!(joined.contains("ControlPersist=no"));
        assert!(!joined.contains("vixl-fixture-not-a-real-password"));
        assert!(!joined.contains("StrictHostKeyChecking=no"));
        assert!(!joined.contains("accept-new"));
        assert!(!joined.contains("/dev/null"));
        assert!(!joined.split_whitespace().any(|part| part == "-f"));
        assert!(!argv_contains_forbidden(&argv.args));
    }

    #[test]
    fn password_only_sets_pubkey_no() {
        let argv = sample(SshInvocation::Master, true, TtyMode::No);
        let joined = argv.args.join(" ");
        assert!(joined.contains("PubkeyAuthentication=no"));
        assert!(!argv.args.iter().any(|arg| arg == "-F"));
        assert!(!joined.contains("/.ssh/config"));
        assert!(!joined.contains("IdentityFile="));
    }

    #[test]
    fn control_forward_binds_loopback_and_keeps_pins() {
        let argv = build_ssh_argv(ArgvRequest {
            destination: "eva",
            control_path: Some("/tmp/vixl-test/cm/abcd"),
            control_master: ControlMasterMode::No,
            tty: TtyMode::No,
            vixl_known_hosts: "/tmp/vixl-test/known_hosts",
            user_known_hosts: "/tmp/user-ssh/known_hosts",
            password_only: false,
            port: Some(22),
            identity_file: None,
            invocation: SshInvocation::ControlForward {
                spec: "127.0.0.1:8080:127.0.0.1:80".to_string(),
            },
            config_file: None,
        });
        let joined = argv.args.join(" ");
        assert!(joined.contains("-O"));
        assert!(joined.contains("forward"));
        assert!(joined.contains("-L"));
        assert!(joined.contains("127.0.0.1:8080:127.0.0.1:80"));
        assert!(joined.contains("ForwardAgent=no"));
        assert!(joined.contains("GatewayPorts=no"));
        assert!(!joined.contains("ClearAllForwardings=yes"));
        assert!(!joined.contains("-A"));
        assert!(!argv_contains_forbidden(&argv.args));
    }

    #[test]
    fn tty_channel_requests_tty() {
        let argv = sample(SshInvocation::Tty { command: None }, false, TtyMode::Force);
        let joined = argv.args.join(" ");
        assert!(joined.contains("-tt"));
        assert!(joined.contains("RequestTTY=yes"));
        assert!(joined.contains("ControlMaster=no"));
        assert!(joined.contains("ForwardAgent=no"));
        assert!(!joined.contains("-A"));
    }

    #[test]
    fn sftp_flag_then_destination_then_subsystem() {
        let argv = sample(SshInvocation::Sftp, false, TtyMode::No);
        let s_at = argv.args.iter().position(|arg| arg == "-s").expect("-s");
        let dest_at = argv
            .args
            .iter()
            .position(|arg| arg == "eva")
            .expect("destination");
        let sub_at = argv
            .args
            .iter()
            .position(|arg| arg == "sftp")
            .expect("subsystem");
        assert!(s_at < dest_at);
        assert!(dest_at < sub_at);
        assert_ne!(argv.args[s_at + 1], "sftp");
    }

    #[test]
    fn known_hosts_order_is_vixl_then_user() {
        let argv = sample(SshInvocation::Master, false, TtyMode::No);
        let option = argv
            .args
            .iter()
            .find(|arg| arg.starts_with("UserKnownHostsFile="))
            .expect("known hosts option");
        let rest = option.trim_start_matches("UserKnownHostsFile=");
        let vixl_at = rest.find("/tmp/vixl-test/known_hosts").expect("vixl file");
        let user_at = rest.find("/tmp/user-ssh/known_hosts").expect("user file");
        assert!(vixl_at < user_at);
    }
}
