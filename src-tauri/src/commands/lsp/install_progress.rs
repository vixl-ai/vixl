use tauri::AppHandle;

use super::super::lsp_install::install_source_label;
use super::state::{transition_with, LspPhase, LspServerState, LspStatePatch};

/// Same-generation Running, Starting, or Stopping still owns the process.
fn standalone_install_blocked(existing: Option<&LspServerState>, generation: u64) -> bool {
    existing.is_some_and(|state| {
        state.generation == generation
            && matches!(
                state.phase,
                LspPhase::Running | LspPhase::Starting | LspPhase::Stopping
            )
    })
}

/// `preserve_live` is set for settled installs, which publish Idle or Error.
/// Ensure-driven installs pass false so Starting can become Installing.
fn installing_write(
    existing: Option<&LspServerState>,
    generation: u64,
    message: String,
    preserve_live: bool,
) -> Option<(LspPhase, LspStatePatch)> {
    if preserve_live && standalone_install_blocked(existing, generation) {
        return None;
    }
    Some((
        LspPhase::Installing,
        LspStatePatch {
            message: Some(Some(message)),
            error: Some(None),
            activity: Some(None),
            ..LspStatePatch::default()
        },
    ))
}

fn finish_standalone_phase(
    existing: Option<&LspServerState>,
    generation: u64,
    began: bool,
    error: Option<String>,
    path_message: Option<String>,
    source: String,
) -> Option<(LspPhase, LspStatePatch)> {
    if standalone_install_blocked(existing, generation) {
        return None;
    }

    let phase = existing.map(|state| state.phase);
    let ours = existing
        .is_some_and(|state| state.phase == LspPhase::Installing && state.generation == generation);

    if let Some(error) = error {
        let idle_like = matches!(phase, None | Some(LspPhase::Missing) | Some(LspPhase::Idle));
        if ours || (!began && idle_like) {
            let mut patch = LspStatePatch::terminal(Some(error));
            patch.source = Some(Some(source));
            return Some((LspPhase::Error, patch));
        }
        return None;
    }

    if !ours {
        return None;
    }

    let mut patch = LspStatePatch::terminal(None);
    patch.message = Some(path_message);
    patch.source = Some(Some(source));
    Some((LspPhase::Idle, patch))
}

pub(crate) async fn mark_server_installing(
    app: &AppHandle,
    server_id: &str,
    generation: u64,
    message: String,
    preserve_live: bool,
) {
    transition_with(app, server_id, generation, move |existing| {
        installing_write(existing, generation, message, preserve_live)
    })
    .await;
}

pub(crate) async fn finish_standalone_install(
    app: &AppHandle,
    server_id: &str,
    generation: u64,
    began: bool,
    error: Option<String>,
    path_message: Option<String>,
) {
    let source = install_source_label(app, server_id);
    transition_with(app, server_id, generation, move |existing| {
        finish_standalone_phase(existing, generation, began, error, path_message, source)
    })
    .await;
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::AtomicU64;

    use super::super::state::{
        apply_transition, ephemeral_state, LspPhase, LspServerState, LspStatePatch, LspStateWrite,
    };
    use super::{finish_standalone_phase, installing_write, standalone_install_blocked};

    fn row(id: &str, phase: LspPhase, generation: u64) -> LspServerState {
        ephemeral_state(id, phase, generation, None, Some("managed".to_string()))
    }

    fn seed(
        states: &mut HashMap<String, LspServerState>,
        revision: &AtomicU64,
        id: &str,
        phase: LspPhase,
        generation: u64,
    ) {
        apply_transition(
            states,
            generation,
            revision,
            LspStateWrite {
                id,
                generation,
                phase,
                patch: LspStatePatch::default(),
                now_ms: 10,
            },
        )
        .unwrap();
    }

    #[test]
    fn settled_install_skips_same_generation_live_phases() {
        for phase in [LspPhase::Running, LspPhase::Starting, LspPhase::Stopping] {
            let state = row("vue", phase, 4);
            assert!(standalone_install_blocked(Some(&state), 4), "{phase:?}");
            assert!(
                installing_write(Some(&state), 4, format!("Installing {phase:?}"), true).is_none()
            );
            assert!(finish_standalone_phase(
                Some(&state),
                4,
                true,
                Some("install failed".to_string()),
                None,
                "managed".to_string(),
            )
            .is_none());
        }
    }

    #[test]
    fn settled_install_still_writes_when_the_row_is_not_live() {
        let idle = row("json", LspPhase::Idle, 2);
        assert!(!standalone_install_blocked(Some(&idle), 2));
        assert!(!standalone_install_blocked(Some(&idle), 1));
        assert!(!standalone_install_blocked(None, 2));

        let running = row("vue", LspPhase::Running, 1);
        assert!(!standalone_install_blocked(Some(&running), 2));

        for phase in [
            LspPhase::Missing,
            LspPhase::Idle,
            LspPhase::NeedsTrust,
            LspPhase::Installing,
            LspPhase::Stopped,
            LspPhase::Exited,
            LspPhase::Crashed,
            LspPhase::Error,
        ] {
            let state = row("markdown", phase, 3);
            let decided =
                installing_write(Some(&state), 3, "Downloading markdown".to_string(), true);
            assert!(decided.is_some(), "{phase:?}");
            let (next, patch) = decided.unwrap();
            assert_eq!(next, LspPhase::Installing);
            assert_eq!(
                patch.message,
                Some(Some("Downloading markdown".to_string()))
            );
            assert_eq!(patch.activity, Some(None));
        }
    }

    #[test]
    fn ensure_install_still_overwrites_starting() {
        let mut states = HashMap::new();
        let revision = AtomicU64::new(0);
        seed(&mut states, &revision, "vue", LspPhase::Starting, 6);
        let existing = states.get("vue").cloned().unwrap();
        assert!(standalone_install_blocked(Some(&existing), 6));

        let (phase, patch) =
            installing_write(Some(&existing), 6, "Installing vue".to_string(), false)
                .expect("ensure install");
        let written = apply_transition(
            &mut states,
            6,
            &revision,
            LspStateWrite {
                id: "vue",
                generation: 6,
                phase,
                patch,
                now_ms: 20,
            },
        )
        .unwrap();
        assert_eq!(written.phase, LspPhase::Installing);
        assert!(!written.running);
        assert_eq!(written.generation, 6);
        assert_eq!(written.message.as_deref(), Some("Installing vue"));
        assert!(written.error.is_none());
        assert!(written.activity.is_none());
    }

    #[test]
    fn settled_install_leaves_a_running_row_unchanged() {
        let mut states = HashMap::new();
        let revision = AtomicU64::new(0);
        seed(&mut states, &revision, "vue", LspPhase::Running, 3);
        let existing = states.get("vue").cloned().unwrap();
        assert!(installing_write(Some(&existing), 3, "Installing vue".to_string(), true).is_none());
        assert!(finish_standalone_phase(
            Some(&existing),
            3,
            true,
            None,
            Some("used PATH".to_string()),
            "managed".to_string(),
        )
        .is_none());

        let kept = states.get("vue").unwrap();
        assert_eq!(kept.phase, LspPhase::Running);
        assert!(kept.running);
        assert_eq!(kept.generation, 3);
        assert_eq!(kept.revision, 1);
    }

    #[test]
    fn settled_finish_idles_an_installing_row_and_errors_idle() {
        let installing = row("yaml", LspPhase::Installing, 2);
        let (phase, patch) = finish_standalone_phase(
            Some(&installing),
            2,
            true,
            None,
            Some("used PATH".to_string()),
            "path".to_string(),
        )
        .unwrap();
        assert_eq!(phase, LspPhase::Idle);
        assert_eq!(patch.message, Some(Some("used PATH".to_string())));
        assert_eq!(patch.error, Some(None));
        assert_eq!(patch.source, Some(Some("path".to_string())));
        assert_eq!(patch.pid, Some(None));

        let (phase, patch) = finish_standalone_phase(
            Some(&installing),
            2,
            true,
            Some("npm failed".to_string()),
            None,
            "managed".to_string(),
        )
        .unwrap();
        assert_eq!(phase, LspPhase::Error);
        assert_eq!(patch.error, Some(Some("npm failed".to_string())));

        let idle = row("yaml", LspPhase::Idle, 2);
        let (phase, _) = finish_standalone_phase(
            Some(&idle),
            2,
            false,
            Some("missing binary".to_string()),
            None,
            "none".to_string(),
        )
        .unwrap();
        assert_eq!(phase, LspPhase::Error);
        let idle_success =
            finish_standalone_phase(Some(&idle), 2, false, None, None, "none".to_string());
        assert!(idle_success.is_none());
        assert!(finish_standalone_phase(
            Some(&installing),
            9,
            true,
            None,
            None,
            "managed".to_string(),
        )
        .is_none());
    }

    #[test]
    fn companion_install_uses_its_own_row() {
        let mut states = HashMap::new();
        let revision = AtomicU64::new(0);
        seed(&mut states, &revision, "vue", LspPhase::Running, 4);
        seed(&mut states, &revision, "typescript", LspPhase::Starting, 4);

        let classic = states.get("typescript-classic").cloned();
        let (phase, _) = installing_write(
            classic.as_ref(),
            0,
            "Installing typescript-classic".to_string(),
            true,
        )
        .expect("companion row is not live");
        assert_eq!(phase, LspPhase::Installing);
        assert_eq!(states["vue"].phase, LspPhase::Running);
        assert_eq!(states["typescript"].phase, LspPhase::Starting);
    }
}
