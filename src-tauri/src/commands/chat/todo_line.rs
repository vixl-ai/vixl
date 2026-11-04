pub(super) fn line_is_todo_update(line: &serde_json::Value) -> bool {
    line.get("harnessEvent")
        .and_then(|event| event.get("type"))
        .and_then(|kind| kind.as_str())
        == Some("todo-update")
}
