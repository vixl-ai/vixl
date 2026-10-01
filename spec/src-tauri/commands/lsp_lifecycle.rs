use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use app_lib::commands::lsp::{
    acquire_start_lock, apply_transition, claim_once, classify_process_exit, process_exit_detail,
    process_exit_status, remove_if_generation, start_lock_for, LspPhase, LspStatePatch,
    LspStateWrite, ProcessExitStatus, ENSURE_DEADLINE, START_LOCK_WAIT,
};

#[test]
fn exit_code_zero_is_exited_and_nonzero_is_crashed() {
    assert_eq!(
        classify_process_exit(false, ProcessExitStatus::Code(0)),
        LspPhase::Exited
    );
    assert_eq!(
        classify_process_exit(false, ProcessExitStatus::Code(3)),
        LspPhase::Crashed
    );
    assert_eq!(
        classify_process_exit(false, ProcessExitStatus::Signal(9)),
        LspPhase::Crashed
    );
    assert_eq!(
        classify_process_exit(false, ProcessExitStatus::Unknown),
        LspPhase::Crashed
    );
    assert!(process_exit_detail(ProcessExitStatus::Code(0), "ignored", None).is_none());

    let detail = process_exit_detail(ProcessExitStatus::Code(3), "boom\n", None).unwrap();
    assert!(detail.contains("exit 3"), "{detail}");
    assert!(detail.contains("boom"), "{detail}");

    let signal = process_exit_detail(ProcessExitStatus::Signal(9), "", None).unwrap();
    assert!(signal.contains("signal 9"), "{signal}");

    let unknown = process_exit_detail(
        ProcessExitStatus::Unknown,
        "",
        Some("stream was not valid LSP"),
    )
    .unwrap();
    assert!(unknown.contains("stream was not valid LSP"), "{unknown}");
}

#[test]
fn stop_request_classifies_as_stopped_for_any_status() {
    for status in [
        ProcessExitStatus::Code(0),
        ProcessExitStatus::Code(3),
        ProcessExitStatus::Signal(9),
        ProcessExitStatus::Unknown,
    ] {
        assert_eq!(
            classify_process_exit(true, status),
            LspPhase::Stopped,
            "{status:?}"
        );
    }
}

#[test]
fn second_exit_claim_is_a_no_op() {
    let flag = AtomicBool::new(false);
    assert!(claim_once(&flag));
    assert!(!claim_once(&flag));
}

#[test]
fn stale_generation_cannot_remove_a_newer_process_or_overwrite_state() {
    let mut servers = HashMap::new();
    servers.insert("vue".to_string(), 2u64);
    assert!(!remove_if_generation(
        &mut servers,
        "vue",
        1,
        |generation| { *generation }
    ));
    assert_eq!(servers.get("vue"), Some(&2));
    assert!(remove_if_generation(&mut servers, "vue", 2, |generation| {
        *generation
    }));
    assert!(servers.is_empty());
    assert!(!remove_if_generation(
        &mut servers,
        "vue",
        2,
        |generation| { *generation }
    ));

    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);
    apply_transition(
        &mut states,
        2,
        &revision,
        LspStateWrite {
            id: "vue",
            generation: 2,
            phase: LspPhase::Running,
            patch: LspStatePatch::default(),
            now_ms: 10,
        },
    )
    .unwrap();
    let dropped = apply_transition(
        &mut states,
        2,
        &revision,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Exited,
            patch: LspStatePatch {
                error: Some(Some("stale exit".to_string())),
                ..LspStatePatch::default()
            },
            now_ms: 20,
        },
    );
    assert!(dropped.is_none());
    assert_eq!(states["vue"].phase, LspPhase::Running);
    assert_eq!(states["vue"].generation, 2);
}

#[cfg(unix)]
#[tokio::test]
async fn spawned_shell_exit_codes_classify() {
    let zero = tokio::process::Command::new("sh")
        .args(["-c", "exit 0"])
        .kill_on_drop(true)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap()
        .wait()
        .await
        .unwrap();
    let zero_status = process_exit_status(zero.code(), exit_signal(&zero));
    assert_eq!(classify_process_exit(false, zero_status), LspPhase::Exited);

    let three = tokio::process::Command::new("sh")
        .args(["-c", "exit 3"])
        .kill_on_drop(true)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap()
        .wait()
        .await
        .unwrap();
    let three_status = process_exit_status(three.code(), exit_signal(&three));
    assert_eq!(
        classify_process_exit(false, three_status),
        LspPhase::Crashed
    );
    assert_eq!(three_status, ProcessExitStatus::Code(3));
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[tokio::test]
async fn start_lock_timeout_fires_without_writing_state() {
    assert_eq!(START_LOCK_WAIT, Duration::from_secs(60));
    assert_eq!(ENSURE_DEADLINE, Duration::from_secs(180));

    let id = format!(
        "lifecycle-lock-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    );
    let lock = start_lock_for(&id).await;
    let _guard = lock.lock().await;
    assert!(acquire_start_lock(&id, Duration::from_millis(40))
        .await
        .is_none());
}
