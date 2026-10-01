use std::collections::HashMap;
use std::sync::atomic::AtomicU64;

use app_lib::commands::lsp::{
    activity_for_running, apply_transition, clear_loading_activity, parse_progress_params,
    running_activity_decision, server_awaits_project_load, should_emit_progress, ActiveProgress,
    LspActivity, LspPhase, LspServerState, LspStatePatch, LspStateWrite, ProgressKind,
    PROGRESS_REPORT_MIN_INTERVAL_MS, PROJECT_LOAD_FUSE_MS,
};

fn apply(progress: &mut ActiveProgress, params: serde_json::Value) {
    progress.apply(parse_progress_params(&params).expect("progress params"));
}

fn server_state(phase: LspPhase, generation: u64, activity: Option<LspActivity>) -> LspServerState {
    LspServerState {
        id: "vue".to_string(),
        phase,
        generation,
        revision: 1,
        phase_since_ms: 0,
        message: None,
        error: None,
        activity,
        source: None,
        workspace_root: None,
        pid: None,
        running: phase == LspPhase::Running,
    }
}

#[test]
fn progress_tracks_latest_token_and_ignores_unknown_end() {
    let mut progress = ActiveProgress::default();
    apply(
        &mut progress,
        serde_json::json!({
            "token": "alpha",
            "value": { "kind": "begin", "title": "Indexing", "message": "start" }
        }),
    );
    apply(
        &mut progress,
        serde_json::json!({
            "token": 7,
            "value": { "kind": "begin", "title": "Checking", "percentage": 10 }
        }),
    );
    let current = progress.current().unwrap();
    assert_eq!(current.token.as_deref(), Some("7"));
    assert_eq!(current.title, "Checking");
    assert_eq!(current.percentage, Some(10));

    apply(
        &mut progress,
        serde_json::json!({
            "token": "alpha",
            "value": { "kind": "report", "message": "types", "percentage": 40 }
        }),
    );
    let current = progress.current().unwrap();
    assert_eq!(current.token.as_deref(), Some("alpha"));
    assert_eq!(current.title, "Indexing");
    assert_eq!(current.message.as_deref(), Some("types"));
    assert_eq!(current.percentage, Some(40));

    apply(
        &mut progress,
        serde_json::json!({
            "token": "alpha",
            "value": { "kind": "report", "percentage": 80 }
        }),
    );
    let current = progress.current().unwrap();
    assert_eq!(current.message.as_deref(), Some("types"));
    assert_eq!(current.percentage, Some(80));

    apply(
        &mut progress,
        serde_json::json!({
            "token": "missing",
            "value": { "kind": "end" }
        }),
    );
    assert_eq!(progress.current().unwrap().token.as_deref(), Some("alpha"));

    let mut empty = ActiveProgress::default();
    apply(
        &mut empty,
        serde_json::json!({
            "token": "missing",
            "value": { "kind": "report", "message": "nope" }
        }),
    );
    assert!(empty.current().is_none());

    apply(
        &mut progress,
        serde_json::json!({ "token": "alpha", "value": { "kind": "end" } }),
    );
    assert_eq!(progress.current().unwrap().token.as_deref(), Some("7"));
    apply(
        &mut progress,
        serde_json::json!({ "token": 7, "value": { "kind": "end" } }),
    );
    assert!(progress.current().is_none());

    assert!(parse_progress_params(&serde_json::json!({})).is_none());
    assert!(parse_progress_params(&serde_json::json!({
        "token": "alpha",
        "value": { "kind": "nope" }
    }))
    .is_none());
}

#[test]
fn report_is_throttled_and_begin_end_are_not() {
    assert_eq!(PROGRESS_REPORT_MIN_INTERVAL_MS, 250);
    assert!(should_emit_progress(
        ProgressKind::Begin,
        1_000,
        Some(1_000)
    ));
    assert!(should_emit_progress(ProgressKind::End, 1_000, Some(1_000)));
    assert!(should_emit_progress(ProgressKind::Report, 1_000, None));
    assert!(!should_emit_progress(
        ProgressKind::Report,
        1_249,
        Some(1_000)
    ));
    assert!(should_emit_progress(
        ProgressKind::Report,
        1_250,
        Some(1_000)
    ));
    assert!(should_emit_progress(
        ProgressKind::Begin,
        1_001,
        Some(1_000)
    ));
}

#[test]
fn activity_write_is_dropped_unless_phase_is_running() {
    let activity = Some(LspActivity {
        token: Some("1".to_string()),
        title: "Indexing".to_string(),
        message: None,
        percentage: None,
    });
    let running = server_state(LspPhase::Running, 4, None);
    let (phase, patch) = running_activity_decision(Some(&running), 4, activity.clone()).unwrap();
    assert_eq!(phase, LspPhase::Running);
    assert_eq!(patch.activity, Some(activity.clone()));

    let clearing = server_state(LspPhase::Running, 4, activity.clone());
    let (_, cleared) = running_activity_decision(Some(&clearing), 4, None).unwrap();
    assert_eq!(cleared.activity, Some(None));
    assert!(running_activity_decision(Some(&running), 4, None).is_none());
    assert!(running_activity_decision(Some(&running), 3, activity.clone()).is_none());
    assert!(running_activity_decision(None, 4, activity.clone()).is_none());
    for phase in [
        LspPhase::Stopping,
        LspPhase::Starting,
        LspPhase::Stopped,
        LspPhase::Exited,
        LspPhase::Crashed,
        LspPhase::Error,
    ] {
        let state = server_state(phase, 4, None);
        assert!(
            running_activity_decision(Some(&state), 4, activity.clone()).is_none(),
            "{phase:?}"
        );
    }
}

#[test]
fn loading_clears_on_diagnostics_and_fuse_while_progress_wins() {
    assert_eq!(PROJECT_LOAD_FUSE_MS, 20_000);
    assert!(server_awaits_project_load("vue"));
    assert!(server_awaits_project_load("typescript"));
    assert!(!server_awaits_project_load("typescript-classic"));
    assert!(!server_awaits_project_load("rust"));

    let loading = activity_for_running(None, true).unwrap();
    assert_eq!(loading.title, "Loading project");
    assert!(loading.token.is_none());
    assert!(loading.message.is_none());
    assert!(loading.percentage.is_none());

    let progress = LspActivity {
        token: Some("idx".to_string()),
        title: "Indexing".to_string(),
        message: None,
        percentage: Some(4),
    };
    assert_eq!(
        activity_for_running(Some(progress.clone()), true)
            .unwrap()
            .title,
        "Indexing"
    );
    assert!(activity_for_running(None, false).is_none());
    assert_eq!(
        activity_for_running(Some(progress.clone()), false)
            .unwrap()
            .title,
        "Indexing"
    );

    let loading_state = server_state(LspPhase::Running, 2, Some(loading.clone()));
    let (phase, patch) = clear_loading_activity(Some(&loading_state), 2).unwrap();
    assert_eq!(phase, LspPhase::Running);
    assert_eq!(patch.activity, Some(None));

    let progress_state = server_state(LspPhase::Running, 2, Some(progress));
    assert!(clear_loading_activity(Some(&progress_state), 2).is_none());

    let stopping = server_state(LspPhase::Stopping, 2, Some(loading.clone()));
    assert!(clear_loading_activity(Some(&stopping), 2).is_none());
    assert!(clear_loading_activity(Some(&loading_state), 1).is_none());
}

#[test]
fn terminal_and_starting_patches_clear_activity() {
    assert_eq!(LspStatePatch::terminal(None).activity, Some(None));
    assert_eq!(
        LspStatePatch::starting("managed".to_string(), "/tmp".to_string(), None).activity,
        Some(None)
    );
    assert_eq!(
        LspStatePatch::from_error_source(Some("trust".to_string()), None).activity,
        Some(None)
    );
    assert!(
        LspStatePatch::running("managed".to_string(), "/tmp".to_string(), Some(1))
            .activity
            .is_none()
    );

    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);
    apply_transition(
        &mut states,
        1,
        &revision,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Running,
            patch: LspStatePatch {
                activity: Some(activity_for_running(None, true)),
                ..LspStatePatch::default()
            },
            now_ms: 10,
        },
    )
    .unwrap();
    let exited = apply_transition(
        &mut states,
        1,
        &revision,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Exited,
            patch: LspStatePatch::terminal(None),
            now_ms: 20,
        },
    )
    .unwrap();
    assert!(exited.activity.is_none());
    assert!(exited.message.is_none());
    assert!(exited.pid.is_none());
}
