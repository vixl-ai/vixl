use tauri::State;

use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn truncate_chat_log(
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
    before_message_id: Option<String>,
    keep_through_last_user: Option<bool>,
    keep_through_message_id: Option<String>,
) -> Result<(), String> {
    let conn = db.lock()?;
    store::get_chat(&conn, &project_slug, &chat_id)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let messages = store::list_messages(&tx, &chat_id)?;
    let keep_count = keep_count(
        &messages,
        before_message_id,
        keep_through_last_user,
        keep_through_message_id,
    )?;
    store::delete_from_seq(&tx, &chat_id, keep_count)?;
    store::bump_updated_at(&tx, &project_slug, &chat_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn keep_count(
    messages: &[serde_json::Value],
    before_message_id: Option<String>,
    keep_through_last_user: Option<bool>,
    keep_through_message_id: Option<String>,
) -> Result<i64, String> {
    let count = if let Some(message_id) = before_message_id {
        messages
            .iter()
            .position(|line| {
                line.get("id")
                    .and_then(|value| value.as_str())
                    .is_some_and(|id| id == message_id)
            })
            .unwrap_or(messages.len())
    } else if let Some(message_id) = keep_through_message_id {
        messages
            .iter()
            .position(|line| {
                line.get("id")
                    .and_then(|value| value.as_str())
                    .is_some_and(|id| id == message_id)
            })
            .map(|index| index + 1)
            .unwrap_or(0)
    } else if keep_through_last_user.unwrap_or(false) {
        messages
            .iter()
            .rposition(|line| {
                line.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|role| role == "user")
            })
            .map(|index| index + 1)
            .unwrap_or(0)
    } else {
        return Err(
            "truncate_chat_log requires before_message_id, keep_through_message_id, or keep_through_last_user"
                .to_string(),
        );
    };
    Ok(count as i64)
}
