use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::oneshot;
use tokio::task::JoinHandle;

pub(super) struct OAuthLoopbackSession {
    pub cancel: oneshot::Sender<()>,
    pub join: JoinHandle<()>,
}

#[derive(Default)]
pub struct OAuthLoopbackState {
    inner: Mutex<HashMap<String, OAuthLoopbackSession>>,
}

impl OAuthLoopbackState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn take_session(&self, flow_id: &str) -> Option<OAuthLoopbackSession> {
        self.inner.lock().ok()?.remove(flow_id)
    }

    pub(super) fn store_session(
        &self,
        flow_id: String,
        session: OAuthLoopbackSession,
    ) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "OAuth loopback state lock poisoned".to_string())?;
        guard.insert(flow_id, session);
        Ok(())
    }

    pub(super) async fn cancel_flow(&self, flow_id: &str) {
        if let Some(session) = self.take_session(flow_id) {
            let _ = session.cancel.send(());
            let _ = session.join.await;
        }
    }
}
