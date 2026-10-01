use std::collections::HashMap;
use std::sync::atomic::AtomicU64;

use app_lib::commands::lsp::{
    apply_transition, LspActivity, LspCatalogEntry, LspPhase, LspServerState, LspStatePatch,
    LspStateWrite,
};

fn write(
    states: &mut HashMap<String, LspServerState>,
    revision: &AtomicU64,
    current_generation: u64,
    attempted: LspStateWrite<'_>,
) -> Option<LspServerState> {
    apply_transition(states, current_generation, revision, attempted)
}

#[test]
fn older_generation_is_dropped_and_current_is_accepted() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);

    let accepted = write(
        &mut states,
        &revision,
        2,
        LspStateWrite {
            id: "vue",
            generation: 2,
            phase: LspPhase::Starting,
            patch: LspStatePatch::default(),
            now_ms: 1_000,
        },
    );
    assert_eq!(accepted.unwrap().phase, LspPhase::Starting);

    let dropped = write(
        &mut states,
        &revision,
        2,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Exited,
            patch: LspStatePatch {
                error: Some(Some("stale exit".to_string())),
                ..LspStatePatch::default()
            },
            now_ms: 2_000,
        },
    );
    assert!(dropped.is_none());

    let kept = states.get("vue").unwrap();
    assert_eq!(kept.phase, LspPhase::Starting);
    assert_eq!(kept.generation, 2);
    assert_eq!(kept.revision, 1);
    assert_eq!(kept.phase_since_ms, 1_000);
    assert!(kept.error.is_none());
}

#[test]
fn revision_is_monotonic_across_writes_and_servers() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);

    let vue_starting = write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Starting,
            patch: LspStatePatch::default(),
            now_ms: 1,
        },
    )
    .unwrap();
    let typescript = write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "typescript",
            generation: 1,
            phase: LspPhase::Starting,
            patch: LspStatePatch::default(),
            now_ms: 2,
        },
    )
    .unwrap();
    let vue_running = write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Running,
            patch: LspStatePatch::default(),
            now_ms: 3,
        },
    )
    .unwrap();

    assert!(vue_starting.revision < typescript.revision);
    assert!(typescript.revision < vue_running.revision);
    assert_eq!(states["vue"].revision, vue_running.revision);
    assert_eq!(states["typescript"].revision, typescript.revision);
}

#[test]
fn phase_since_ms_stays_when_phase_is_unchanged() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);

    write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Starting,
            patch: LspStatePatch::default(),
            now_ms: 1_000,
        },
    )
    .unwrap();

    let same_phase = write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Starting,
            patch: LspStatePatch {
                message: Some(Some("still starting".to_string())),
                ..LspStatePatch::default()
            },
            now_ms: 5_000,
        },
    )
    .unwrap();
    assert_eq!(same_phase.phase_since_ms, 1_000);
    assert_eq!(same_phase.message.as_deref(), Some("still starting"));

    let next_phase = write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Running,
            patch: LspStatePatch::default(),
            now_ms: 9_000,
        },
    )
    .unwrap();
    assert_eq!(next_phase.phase_since_ms, 9_000);
    assert_eq!(next_phase.message.as_deref(), Some("still starting"));
}

#[test]
fn running_is_derived_from_phase() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);

    let running = write(
        &mut states,
        &revision,
        0,
        LspStateWrite {
            id: "vue",
            generation: 0,
            phase: LspPhase::Running,
            patch: LspStatePatch::default(),
            now_ms: 1,
        },
    )
    .unwrap();
    assert!(running.running);
    assert_eq!(running.phase, LspPhase::Running);

    let stopped = write(
        &mut states,
        &revision,
        0,
        LspStateWrite {
            id: "vue",
            generation: 0,
            phase: LspPhase::Stopped,
            patch: LspStatePatch::default(),
            now_ms: 2,
        },
    )
    .unwrap();
    assert!(!stopped.running);
    assert_eq!(stopped.phase, LspPhase::Stopped);
}

#[test]
fn patch_none_keeps_and_some_none_clears() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);

    write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Error,
            patch: LspStatePatch {
                error: Some(Some("install failed".to_string())),
                source: Some(Some("managed".to_string())),
                message: Some(Some("Downloading vue".to_string())),
                ..LspStatePatch::default()
            },
            now_ms: 1,
        },
    )
    .unwrap();

    let kept = write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Starting,
            patch: LspStatePatch {
                error: Some(None),
                ..LspStatePatch::default()
            },
            now_ms: 2,
        },
    )
    .unwrap();
    assert!(kept.error.is_none());
    assert_eq!(kept.source.as_deref(), Some("managed"));
    assert_eq!(kept.message.as_deref(), Some("Downloading vue"));

    let cleared = write(
        &mut states,
        &revision,
        1,
        LspStateWrite {
            id: "vue",
            generation: 1,
            phase: LspPhase::Starting,
            patch: LspStatePatch {
                message: Some(None),
                ..LspStatePatch::default()
            },
            now_ms: 3,
        },
    )
    .unwrap();
    assert!(cleared.message.is_none());
    assert_eq!(cleared.source.as_deref(), Some("managed"));
}

#[test]
fn same_generation_running_after_crashed_is_dropped() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);
    let crash = "Language server crashed (exit 1)";

    let crashed = write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "vue",
            generation: 4,
            phase: LspPhase::Crashed,
            patch: LspStatePatch::terminal(Some(crash.to_string())),
            now_ms: 10,
        },
    )
    .unwrap();
    assert_eq!(crashed.phase, LspPhase::Crashed);
    assert_eq!(crashed.revision, 1);

    let dropped = write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "vue",
            generation: 4,
            phase: LspPhase::Running,
            patch: LspStatePatch::running("managed".to_string(), "/tmp/app".to_string(), Some(42)),
            now_ms: 20,
        },
    );
    assert!(dropped.is_none());

    let activity_dropped = write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "vue",
            generation: 4,
            phase: LspPhase::Running,
            patch: LspStatePatch {
                activity: Some(Some(LspActivity {
                    token: None,
                    title: "Indexing".to_string(),
                    message: None,
                    percentage: None,
                })),
                ..LspStatePatch::default()
            },
            now_ms: 25,
        },
    );
    assert!(activity_dropped.is_none());

    let kept = states.get("vue").unwrap();
    assert_eq!(kept.phase, LspPhase::Crashed);
    assert!(!kept.running);
    assert_eq!(kept.generation, 4);
    assert_eq!(kept.revision, 1);
    assert_eq!(kept.phase_since_ms, 10);
    assert_eq!(kept.error.as_deref(), Some(crash));
    assert!(kept.pid.is_none());
    assert!(kept.activity.is_none());
    assert!(kept.source.is_none());

    let running = write(
        &mut states,
        &revision,
        5,
        LspStateWrite {
            id: "vue",
            generation: 5,
            phase: LspPhase::Running,
            patch: LspStatePatch::running("managed".to_string(), "/tmp/app".to_string(), Some(99)),
            now_ms: 30,
        },
    )
    .unwrap();
    assert_eq!(running.phase, LspPhase::Running);
    assert!(running.running);
    assert_eq!(running.generation, 5);
    assert_eq!(running.revision, 2);
    assert_eq!(running.phase_since_ms, 30);
    assert_eq!(running.pid, Some(99));
    assert_eq!(running.source.as_deref(), Some("managed"));
    assert!(running.error.is_none());
}

#[test]
fn stop_during_starting_drops_same_generation_running() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);

    write(
        &mut states,
        &revision,
        6,
        LspStateWrite {
            id: "vue",
            generation: 6,
            phase: LspPhase::Starting,
            patch: LspStatePatch::starting("managed".to_string(), "/tmp/app".to_string(), None),
            now_ms: 10,
        },
    )
    .unwrap();

    let stopped = write(
        &mut states,
        &revision,
        6,
        LspStateWrite {
            id: "vue",
            generation: 6,
            phase: LspPhase::Stopped,
            patch: LspStatePatch::terminal(None),
            now_ms: 20,
        },
    )
    .unwrap();
    assert_eq!(stopped.phase, LspPhase::Stopped);
    assert_eq!(stopped.revision, 2);
    assert_eq!(stopped.phase_since_ms, 20);
    assert_eq!(stopped.source.as_deref(), Some("managed"));
    assert_eq!(stopped.workspace_root.as_deref(), Some("/tmp/app"));
    assert!(stopped.pid.is_none());

    let dropped = write(
        &mut states,
        &revision,
        6,
        LspStateWrite {
            id: "vue",
            generation: 6,
            phase: LspPhase::Running,
            patch: LspStatePatch::running("managed".to_string(), "/tmp/app".to_string(), Some(42)),
            now_ms: 30,
        },
    );
    assert!(dropped.is_none());

    let kept = states.get("vue").unwrap();
    assert_eq!(kept.phase, LspPhase::Stopped);
    assert!(!kept.running);
    assert_eq!(kept.generation, 6);
    assert_eq!(kept.revision, 2);
    assert_eq!(kept.phase_since_ms, 20);
    assert!(kept.pid.is_none());
    assert!(kept.error.is_none());
    assert_eq!(kept.source.as_deref(), Some("managed"));
    assert_eq!(kept.workspace_root.as_deref(), Some("/tmp/app"));
}

#[test]
fn stopping_reaches_stopped_and_bumped_error_still_applies() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);

    write(
        &mut states,
        &revision,
        3,
        LspStateWrite {
            id: "vue",
            generation: 3,
            phase: LspPhase::Stopping,
            patch: LspStatePatch::default(),
            now_ms: 10,
        },
    )
    .unwrap();
    let stopped = write(
        &mut states,
        &revision,
        3,
        LspStateWrite {
            id: "vue",
            generation: 3,
            phase: LspPhase::Stopped,
            patch: LspStatePatch::terminal(None),
            now_ms: 20,
        },
    )
    .unwrap();
    assert_eq!(stopped.phase, LspPhase::Stopped);
    assert!(!stopped.running);

    let dropped = write(
        &mut states,
        &revision,
        3,
        LspStateWrite {
            id: "vue",
            generation: 3,
            phase: LspPhase::Running,
            patch: LspStatePatch::running("managed".to_string(), "/tmp/app".to_string(), Some(7)),
            now_ms: 30,
        },
    );
    assert!(dropped.is_none());
    assert_eq!(states["vue"].phase, LspPhase::Stopped);
    assert!(states["vue"].pid.is_none());

    let failed = write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "vue",
            generation: 4,
            phase: LspPhase::Error,
            patch: LspStatePatch::terminal(Some("Timed out starting vue".to_string())),
            now_ms: 40,
        },
    )
    .unwrap();
    assert_eq!(failed.phase, LspPhase::Error);
    assert_eq!(failed.generation, 4);
    assert_eq!(failed.error.as_deref(), Some("Timed out starting vue"));
}

#[test]
fn needs_trust_after_same_generation_stop_keeps_source_and_drops_stale_exit() {
    let mut states = HashMap::new();
    let revision = AtomicU64::new(0);
    let trust_error = "Workspace trust required for this language server";

    write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "biome",
            generation: 4,
            phase: LspPhase::Running,
            patch: LspStatePatch::running("path".to_string(), "/tmp/trusted".to_string(), Some(11)),
            now_ms: 10,
        },
    )
    .unwrap();
    write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "biome",
            generation: 4,
            phase: LspPhase::Stopping,
            patch: LspStatePatch::default(),
            now_ms: 20,
        },
    )
    .unwrap();
    let stopped = write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "biome",
            generation: 4,
            phase: LspPhase::Stopped,
            patch: LspStatePatch::terminal(None),
            now_ms: 30,
        },
    )
    .unwrap();
    assert_eq!(stopped.phase, LspPhase::Stopped);
    assert_eq!(stopped.revision, 3);
    assert!(stopped.pid.is_none());
    assert_eq!(stopped.source.as_deref(), Some("path"));

    let mut patch = LspStatePatch::from_error_source(Some(trust_error.to_string()), None);
    patch.message = Some(None);
    patch.pid = Some(None);
    let needs_trust = write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "biome",
            generation: 4,
            phase: LspPhase::NeedsTrust,
            patch,
            now_ms: 40,
        },
    )
    .unwrap();
    assert_eq!(needs_trust.phase, LspPhase::NeedsTrust);
    assert!(!needs_trust.running);
    assert_eq!(needs_trust.generation, 4);
    assert_eq!(needs_trust.revision, 4);
    assert_eq!(needs_trust.phase_since_ms, 40);
    assert_eq!(needs_trust.error.as_deref(), Some(trust_error));
    assert!(needs_trust.message.is_none());
    assert!(needs_trust.pid.is_none());
    assert_eq!(needs_trust.source.as_deref(), Some("path"));
    assert_eq!(needs_trust.workspace_root.as_deref(), Some("/tmp/trusted"));

    let dropped = write(
        &mut states,
        &revision,
        4,
        LspStateWrite {
            id: "biome",
            generation: 3,
            phase: LspPhase::Crashed,
            patch: LspStatePatch::terminal(Some("stale exit".to_string())),
            now_ms: 50,
        },
    );
    assert!(dropped.is_none());
    let kept = states.get("biome").unwrap();
    assert_eq!(kept.phase, LspPhase::NeedsTrust);
    assert_eq!(kept.revision, 4);
    assert_eq!(kept.source.as_deref(), Some("path"));
}

#[test]
fn phase_json_matches_as_str() {
    let phases = [
        LspPhase::Missing,
        LspPhase::Idle,
        LspPhase::NeedsTrust,
        LspPhase::Installing,
        LspPhase::Starting,
        LspPhase::Running,
        LspPhase::Stopping,
        LspPhase::Stopped,
        LspPhase::Exited,
        LspPhase::Crashed,
        LspPhase::Error,
    ];
    for phase in phases {
        assert_eq!(
            serde_json::to_value(phase).unwrap(),
            serde_json::json!(phase.as_str())
        );
    }
}

#[test]
fn server_state_and_catalog_entry_serialize_camel_case() {
    let state = LspServerState {
        id: "vue".to_string(),
        phase: LspPhase::Running,
        generation: 3,
        revision: 9,
        phase_since_ms: 1_700_000_000_000,
        message: Some("Downloading vue".to_string()),
        error: None,
        activity: Some(LspActivity {
            token: Some("1".to_string()),
            title: "Loading project".to_string(),
            message: None,
            percentage: Some(40),
        }),
        source: Some("managed".to_string()),
        workspace_root: Some("/tmp/app".to_string()),
        pid: Some(42),
        running: true,
    };
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "id": "vue",
            "phase": "running",
            "generation": 3,
            "revision": 9,
            "phaseSinceMs": 1700000000000u64,
            "message": "Downloading vue",
            "error": null,
            "activity": {
                "token": "1",
                "title": "Loading project",
                "message": null,
                "percentage": 40
            },
            "source": "managed",
            "workspaceRoot": "/tmp/app",
            "pid": 42,
            "running": true
        })
    );

    let entry = LspCatalogEntry {
        id: "vue".to_string(),
        label: "Vue / Nuxt".to_string(),
        extensions: vec![".vue".to_string()],
        install_kind: "npm".to_string(),
        requires_trust: false,
        installable: true,
        installed: true,
        disabled: false,
        can_disable: true,
        state: state.clone(),
    };
    let entry_json = serde_json::to_value(&entry).unwrap();
    assert!(entry_json.get("running").is_none());
    assert!(entry_json.get("error").is_none());
    assert!(entry_json.get("source").is_none());
    assert!(entry_json.get("installState").is_none());
    assert_eq!(entry_json["installKind"], "npm");
    assert_eq!(entry_json["requiresTrust"], false);
    assert_eq!(entry_json["canDisable"], true);
    assert_eq!(entry_json["state"]["phase"], "running");
    assert_eq!(entry_json["state"]["phaseSinceMs"], 1_700_000_000_000u64);
}
