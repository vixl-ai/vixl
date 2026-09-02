use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

pub async fn named_lock_for(
    map: &Mutex<HashMap<String, Arc<Mutex<()>>>>,
    id: &str,
) -> Arc<Mutex<()>> {
    let mut locks = map.lock().await;
    locks
        .entry(id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}
