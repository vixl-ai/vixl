use std::future::Future;

use tokio::time::{timeout, Duration};

pub const LSP_WRITE_TIMEOUT: Duration = Duration::from_secs(10);
pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(120);

pub async fn with_timeout<T>(
    duration: Duration,
    fut: impl Future<Output = Result<T, String>>,
    message: &str,
) -> Result<T, String> {
    match timeout(duration, fut).await {
        Ok(result) => result,
        Err(_) => Err(message.to_string()),
    }
}
