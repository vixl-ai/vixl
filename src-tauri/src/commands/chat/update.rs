use tauri::{AppHandle, State};

use super::meta::{now_iso, ChatMeta};
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn update_chat_meta(
    app: AppHandle,
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
    patch: serde_json::Value,
) -> Result<ChatMeta, String> {
    let refresh = patch_refreshes_tray(&patch);
    let updated = {
        let conn = db.lock()?;
        let record = store::get_chat(&conn, &project_slug, &chat_id)?;
        let mut meta = serde_json::to_value(&record.meta).map_err(|e| e.to_string())?;
        if let Some(obj) = patch.as_object() {
            for (key, value) in obj {
                meta[key] = value.clone();
            }
        }
        meta["updatedAt"] = serde_json::Value::String(now_iso());
        let updated: ChatMeta = serde_json::from_value(meta).map_err(|e| e.to_string())?;
        store::update_chat(&conn, &updated, &record.project_id)?;
        updated
    };
    if refresh {
        if let Err(error) = crate::tray::refresh_agents(&app) {
            log::error!("Failed to refresh tray agents: {error}");
        }
    }
    Ok(updated)
}

fn patch_refreshes_tray(patch: &serde_json::Value) -> bool {
    let Some(obj) = patch.as_object() else {
        return false;
    };
    obj.contains_key("status") || obj.contains_key("activePlanPath") || obj.contains_key("title")
}

#[cfg(test)]
mod tests {
    use super::patch_refreshes_tray;

    #[test]
    fn title_status_and_plan_patches_refresh_tray() {
        assert!(patch_refreshes_tray(
            &serde_json::json!({ "title": "Renamed" })
        ));
        assert!(patch_refreshes_tray(
            &serde_json::json!({ "status": "running" })
        ));
        assert!(patch_refreshes_tray(
            &serde_json::json!({ "activePlanPath": ".vixl/plans/a/PLAN.md" })
        ));
        assert!(!patch_refreshes_tray(
            &serde_json::json!({ "pinned": true })
        ));
        assert!(!patch_refreshes_tray(&serde_json::json!("nope")));
    }
}
