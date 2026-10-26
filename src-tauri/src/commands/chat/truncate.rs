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
            .rposition(is_keep_through_user_line)
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

fn is_keep_through_user_line(line: &serde_json::Value) -> bool {
    let harness_type = line
        .get("harnessEvent")
        .and_then(|value| value.get("type"))
        .and_then(|value| value.as_str());
    if harness_type == Some("background-wake") {
        return false;
    }
    line.get("role")
        .and_then(|value| value.as_str())
        .is_some_and(|role| role == "user")
}

#[cfg(test)]
mod tests {
    use super::keep_count;

    #[test]
    fn keep_through_last_user_skips_trailing_background_wake_even_if_role_is_user() {
        let lines = vec![
            serde_json::json!({
                "id": "u1",
                "role": "user",
                "parts": [{ "type": "text", "text": "real prompt" }]
            }),
            serde_json::json!({
                "id": "a1",
                "role": "assistant",
                "parts": [{ "type": "text", "text": "ok" }]
            }),
            serde_json::json!({
                "id": "wake",
                "role": "user",
                "parts": [],
                "harnessEvent": {
                    "type": "background-wake",
                    "content": "wake body"
                }
            }),
        ];
        let count = keep_count(&lines, None, Some(true), None).expect("keep count");
        assert_eq!(count, 1);
        let kept: Vec<&str> = lines
            .iter()
            .take(count as usize)
            .filter_map(|line| line.get("id").and_then(|value| value.as_str()))
            .collect();
        assert_eq!(kept, ["u1"]);
    }
}
