use rusqlite::types::ValueRef;
use serde_json::Value;

pub fn opt_json(value: &Option<Value>) -> Result<Option<String>, String> {
    match value {
        Some(json) => serde_json::to_string(json)
            .map(Some)
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

pub fn parse_opt_json(text: Option<String>) -> Result<Option<Value>, String> {
    match text {
        Some(raw) if !raw.is_empty() => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        _ => Ok(None),
    }
}

pub fn value_to_json_text(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}

pub fn parse_json_text(text: &str) -> Result<Value, String> {
    serde_json::from_str(text).map_err(|e| e.to_string())
}

pub fn column_opt_string(value: ValueRef<'_>) -> rusqlite::Result<Option<String>> {
    match value {
        ValueRef::Null => Ok(None),
        ValueRef::Text(bytes) => std::str::from_utf8(bytes)
            .map(|s| Some(s.to_string()))
            .map_err(|e| rusqlite::Error::Utf8Error(e)),
        ValueRef::Blob(bytes) => std::str::from_utf8(bytes)
            .map(|s| Some(s.to_string()))
            .map_err(|e| rusqlite::Error::Utf8Error(e)),
        other => Err(rusqlite::Error::InvalidColumnType(
            0,
            "text".to_string(),
            other.data_type(),
        )),
    }
}
