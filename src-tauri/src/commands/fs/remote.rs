use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[cfg(test)]
use std::sync::atomic::AtomicBool;

use futures_util::future::BoxFuture;
use tokio::sync::Mutex;
use url::Url;

use crate::commands::ssh::{
    is_ssh_root, open_sftp, reject_git_hooks_write, require_live_master, session_key,
    take_channel_stdio, SessionKey,
};

use super::diff::build_file_diff;
use super::path::{
    canonical_project_root, reject_sensitive_path_unless_allowed, resolve_command_path,
    ResolvedWorkspacePath, WorkspaceRootArg,
};
use super::sftp::{Attrs, SftpClient};
use super::types::{
    FileDiff, FsDirEntry, FsEditReplacement, FsReadFileResult, FsStagePreviewRequest, FsStatResult,
    FsTreeNode,
};

#[cfg(test)]
static FORCE_WRITE_SIZE_MISMATCH: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
static SFTP_CLOSE_TICKS: AtomicU64 = AtomicU64::new(0);

struct SftpPoolSlot {
    opened_for: AtomicU64,
    client: Mutex<Option<SftpClient>>,
}

lazy_static::lazy_static! {
    static ref SFTP_POOL: Mutex<HashMap<SessionKey, Arc<SftpPoolSlot>>> = Mutex::new(HashMap::new());
}

#[derive(Clone, Debug)]
pub(crate) struct SshProjectRoot {
    pub user: String,
    pub hostname: String,
    pub port: u16,
    pub remote_path: String,
}

#[derive(Clone, Debug)]
pub(crate) struct SshResolved {
    pub slug: Option<String>,
    pub ssh: SshProjectRoot,
    pub relative: String,
}

impl SshResolved {
    pub(crate) fn reported_path(&self) -> String {
        match &self.slug {
            Some(slug) if self.relative.is_empty() => slug.clone(),
            Some(slug) => format!("{slug}/{}", self.relative),
            None => self.relative.clone(),
        }
    }

    pub(crate) fn hostname(&self) -> &str {
        &self.ssh.hostname
    }
}

pub(crate) enum FsTarget {
    Local(ResolvedWorkspacePath),
    Ssh(SshResolved),
}

pub(crate) fn uses_ssh_transport(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
) -> bool {
    if project_root.trim().starts_with("ssh://") {
        return true;
    }
    project_roots
        .unwrap_or(&[])
        .iter()
        .any(|root| root.path.trim().starts_with("ssh://"))
}

pub(crate) fn parse_ssh_project_root(value: &str) -> Result<SshProjectRoot, String> {
    let trimmed = value.trim();
    if !trimmed.starts_with("ssh://") {
        return Err("SSH project root must start with ssh://".to_string());
    }
    let url = Url::parse(trimmed).map_err(|err| format!("Invalid SSH project root: {err}"))?;
    if url.scheme() != "ssh" {
        return Err("SSH project root must start with ssh://".to_string());
    }
    if url.password().is_some() {
        return Err("Vixl will not open an SSH project root that contains a password.".to_string());
    }
    let user = url.username();
    if user.is_empty() {
        return Err("SSH project root is missing a user.".to_string());
    }
    let hostname = url
        .host_str()
        .ok_or_else(|| "SSH project root is missing a host.".to_string())?;
    let port = url.port().unwrap_or(22);
    let mut remote_path = String::new();
    match url.path_segments() {
        None => remote_path.push('/'),
        Some(segments) => {
            for segment in segments {
                remote_path.push('/');
                remote_path.push_str(segment);
            }
            if remote_path.is_empty() {
                remote_path.push('/');
            }
        }
    }
    if remote_path == "/" {
        return Err(opening_slash_refused(hostname));
    }
    Ok(SshProjectRoot {
        user: user.to_string(),
        hostname: hostname.to_string(),
        port,
        remote_path,
    })
}

pub(crate) fn opening_slash_refused(hostname: &str) -> String {
    format!("Opening / on {hostname} is refused.")
}

fn unreachable_err(hostname: &str) -> String {
    format!("{hostname} is unreachable.")
}

fn name_rejected(hostname: &str) -> String {
    format!("Name rejected on {hostname}.")
}

fn utf8_name_err(hostname: &str) -> String {
    format!("Name is not valid UTF-8 on {hostname}.")
}

fn escape_err(hostname: &str) -> String {
    format!("Path escapes project root on {hostname}.")
}

fn broken_symlink_err(hostname: &str) -> String {
    format!("Broken symlink on {hostname}.")
}

fn not_regular_err(hostname: &str) -> String {
    format!("Not a regular file on {hostname}.")
}

fn not_directory_err(hostname: &str) -> String {
    format!("Not a directory on {hostname}.")
}

pub(crate) fn validate_relative(user_path: &str, hostname: &str) -> Result<Vec<String>, String> {
    if user_path.contains('\0') {
        return Err(name_rejected(hostname));
    }
    let trimmed = user_path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }
    if trimmed.starts_with('/') {
        return Err("Path must be relative to the project root".to_string());
    }
    let mut parts = Vec::new();
    for part in trimmed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err("Path traversal is not allowed".to_string());
        }
        if part.contains('\0') || part.contains('\n') || part.contains('\r') {
            return Err(name_rejected(hostname));
        }
        if std::str::from_utf8(part.as_bytes()).is_err() {
            return Err(utf8_name_err(hostname));
        }
        parts.push(part.to_string());
    }
    Ok(parts)
}

fn join_remote(root: &str, parts: &[String]) -> String {
    let mut path = root.trim_end_matches('/').to_string();
    if path.is_empty() {
        path.push('/');
    }
    for part in parts {
        if path == "/" {
            path.push_str(part);
        } else {
            path.push('/');
            path.push_str(part);
        }
    }
    path
}

fn under_root(root: &str, path: &str, hostname: &str) -> Result<(), String> {
    let root = root.trim_end_matches('/');
    let path = path.trim_end_matches('/');
    if path == root {
        return Ok(());
    }
    if path.starts_with(&format!("{root}/")) {
        return Ok(());
    }
    Err(escape_err(hostname))
}

fn split_first_segment(user_path: &str) -> (Option<String>, String) {
    let trimmed = user_path.trim();
    let mut seen = false;
    let mut first = None;
    let mut rest = Vec::new();
    for part in trimmed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if !seen {
            first = Some(part.to_string());
            seen = true;
        } else {
            rest.push(part);
        }
    }
    (first, rest.join("/"))
}

enum Member {
    Local { slug: String, path: PathBuf },
    Ssh { slug: String, root: SshProjectRoot },
    Missing { slug: String },
}

fn load_members(args: &[WorkspaceRootArg]) -> Result<Vec<Member>, String> {
    let mut members = Vec::with_capacity(args.len());
    let mut seen = std::collections::HashSet::new();
    for arg in args {
        let slug = arg.slug.trim();
        if slug.is_empty() {
            return Err("Project slug is required".to_string());
        }
        if slug == "."
            || slug == ".."
            || slug.contains('/')
            || slug.contains('\\')
            || slug.contains('\0')
        {
            return Err(format!("Invalid project slug: {slug}"));
        }
        if !seen.insert(slug.to_string()) {
            return Err(format!("Duplicate project slug: {slug}"));
        }
        let path = arg.path.trim();
        if path.is_empty() {
            members.push(Member::Missing {
                slug: slug.to_string(),
            });
            continue;
        }
        if path.starts_with("ssh://") {
            members.push(Member::Ssh {
                slug: slug.to_string(),
                root: parse_ssh_project_root(path)?,
            });
            continue;
        }
        members.push(Member::Local {
            slug: slug.to_string(),
            path: canonical_project_root(path)?,
        });
    }
    Ok(members)
}

pub(crate) fn resolve_target(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    user_path: &str,
) -> Result<FsTarget, String> {
    if let Some(args) = project_roots.filter(|roots| !roots.is_empty()) {
        let members = load_members(args)?;
        return resolve_against_members(&members, user_path);
    }
    if project_root.trim().starts_with("ssh://") {
        let ssh = parse_ssh_project_root(project_root)?;
        let relative_parts = validate_relative(user_path, &ssh.hostname)?;
        return Ok(FsTarget::Ssh(SshResolved {
            slug: None,
            ssh,
            relative: relative_parts.join("/"),
        }));
    }
    Ok(FsTarget::Local(resolve_command_path(
        project_root,
        project_roots,
        user_path,
    )?))
}

fn resolve_against_members(members: &[Member], user_path: &str) -> Result<FsTarget, String> {
    let trimmed = user_path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }
    if trimmed.starts_with('/') {
        return resolve_absolute_local_members(members, trimmed);
    }
    let (first, rest) = split_first_segment(trimmed);
    if let Some(segment) = first {
        if let Some(member) = members.iter().find(|member| member_slug(member) == segment) {
            return join_member(member, &rest);
        }
    }
    if members.len() == 1 {
        return join_member(&members[0], trimmed);
    }
    let slugs = members
        .iter()
        .map(member_slug)
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Path must be prefixed with a project slug. Valid slugs: {slugs}"
    ))
}

fn member_slug(member: &Member) -> &str {
    match member {
        Member::Local { slug, .. } | Member::Ssh { slug, .. } | Member::Missing { slug } => slug,
    }
}

fn join_member(member: &Member, relative: &str) -> Result<FsTarget, String> {
    match member {
        Member::Missing { slug } => Err(format!("Project {slug} is no longer available")),
        Member::Local { slug, path } => {
            let user_path = if relative.is_empty() { "." } else { relative };
            let resolved = resolve_command_path(&path.to_string_lossy(), None, user_path)?;
            Ok(FsTarget::Local(ResolvedWorkspacePath {
                slug: Some(slug.clone()),
                root: path.clone(),
                path: resolved.path,
            }))
        }
        Member::Ssh { slug, root } => {
            let parts = if relative.is_empty() || relative == "." {
                Vec::new()
            } else {
                validate_relative(relative, &root.hostname)?
            };
            Ok(FsTarget::Ssh(SshResolved {
                slug: Some(slug.clone()),
                ssh: root.clone(),
                relative: parts.join("/"),
            }))
        }
    }
}

fn resolve_absolute_local_members(members: &[Member], user_path: &str) -> Result<FsTarget, String> {
    let mut matches = Vec::new();
    for member in members {
        if let Member::Local { slug, path } = member {
            if let Ok(resolved) = resolve_command_path(&path.to_string_lossy(), None, user_path) {
                matches.push(FsTarget::Local(ResolvedWorkspacePath {
                    slug: Some(slug.clone()),
                    root: path.clone(),
                    path: resolved.path,
                }));
            }
        }
    }
    if matches.len() == 1 {
        return Ok(matches.remove(0));
    }
    if matches.is_empty() {
        return Err("Path must be relative to the project root".to_string());
    }
    Err("Absolute path is outside all project roots".to_string())
}

fn run<T>(
    fut: impl std::future::Future<Output = Result<T, String>> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
{
    crate::commands::ssh::block_on(fut)
}

#[cfg(test)]
pub(crate) async fn insert_silent_sftp_for_test(
    key: SessionKey,
    hostname: String,
) -> tokio::process::Child {
    use std::process::Stdio;

    use crate::commands::ssh::ChannelStdio;

    let mut child = tokio::process::Command::new("cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("cat");
    let stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let client = SftpClient::from_stdio_for_test(
        ChannelStdio {
            stdin,
            stdout,
            stderr: None,
            channel_id: format!("test-silent-{}", key.hostname),
        },
        hostname,
    );
    SFTP_POOL.lock().await.insert(
        key,
        Arc::new(SftpPoolSlot {
            opened_for: AtomicU64::new(1),
            client: Mutex::new(Some(client)),
        }),
    );
    child
}

#[cfg(test)]
pub(crate) async fn hold_pooled_sftp_for_test(
    key: &SessionKey,
) -> tokio::sync::oneshot::Sender<()> {
    let slot = {
        let pool = SFTP_POOL.lock().await;
        pool.get(key).cloned().expect("pooled sftp")
    };
    let probe = slot.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let guard = slot.client.lock().await;
        let _ = rx.await;
        drop(guard);
    });
    let started = std::time::Instant::now();
    loop {
        tokio::task::yield_now().await;
        if probe.client.try_lock().is_err() {
            break;
        }
        if started.elapsed() > std::time::Duration::from_secs(2) {
            panic!("pooled sftp lock was not taken");
        }
    }
    tx
}

#[cfg(test)]
pub(crate) fn sftp_close_ticks() -> u64 {
    SFTP_CLOSE_TICKS.load(Ordering::SeqCst)
}

#[cfg(test)]
pub(crate) async fn pooled_client_open(key: &SessionKey) -> bool {
    let slot = {
        let pool = SFTP_POOL.lock().await;
        pool.get(key).cloned()
    };
    match slot {
        Some(slot) => slot.client.lock().await.is_some(),
        None => false,
    }
}

#[cfg(test)]
pub(crate) async fn retarget_pooled_client_for_test(key: &SessionKey, generation: u64) {
    let pool = SFTP_POOL.lock().await;
    if let Some(slot) = pool.get(key) {
        slot.opened_for.store(generation, Ordering::SeqCst);
    }
}

fn pooled_client_needs_reopen(opened_for: u64, generation: u64, present: bool) -> bool {
    !present || opened_for != generation
}

fn prepare_pooled_client(
    slot: &SftpPoolSlot,
    guard: &mut Option<SftpClient>,
    generation: u64,
) -> bool {
    if pooled_client_needs_reopen(
        slot.opened_for.load(Ordering::SeqCst),
        generation,
        guard.is_some(),
    ) {
        *guard = None;
        return true;
    }
    false
}

#[cfg(test)]
pub(crate) async fn forget_stale_pooled_client(key: &SessionKey, generation: u64) -> bool {
    let slot = {
        let pool = SFTP_POOL.lock().await;
        pool.get(key).cloned()
    };
    let Some(slot) = slot else {
        return false;
    };
    let mut guard = slot.client.lock().await;
    prepare_pooled_client(&slot, &mut guard, generation)
}

fn drop_client(slot: &SftpPoolSlot, guard: &mut Option<SftpClient>) {
    *guard = None;
    slot.opened_for.store(0, Ordering::SeqCst);
}

pub(crate) async fn close_pooled_sftp(key: &SessionKey) {
    let slot = {
        let pool = SFTP_POOL.lock().await;
        pool.get(key).cloned()
    };
    let Some(slot) = slot else {
        return;
    };
    if let Ok(mut guard) = slot.client.try_lock() {
        if require_live_master(key).await.is_err() {
            drop_client(&slot, &mut guard);
        }
        return;
    }
    let opened_for = slot.opened_for.load(Ordering::SeqCst);
    let key = key.clone();
    tokio::spawn(async move {
        let mut guard = slot.client.lock().await;
        if slot.opened_for.load(Ordering::SeqCst) == opened_for
            && require_live_master(&key).await.is_err()
        {
            drop_client(&slot, &mut guard);
        }
        #[cfg(test)]
        SFTP_CLOSE_TICKS.fetch_add(1, Ordering::SeqCst);
    });
}

async fn with_sftp<T, F>(ssh: &SshProjectRoot, f: F) -> Result<T, String>
where
    F: for<'a> FnOnce(&'a mut SftpClient) -> BoxFuture<'a, Result<T, String>>,
{
    let key = session_key(&ssh.user, &ssh.hostname, ssh.port);
    let generation = match require_live_master(&key).await {
        Ok(live) => live.generation,
        Err(err) => {
            close_pooled_sftp(&key).await;
            return Err(map_transport(&ssh.hostname, err));
        }
    };
    let slot = {
        let mut pool = SFTP_POOL.lock().await;
        pool.entry(key.clone())
            .or_insert_with(|| {
                Arc::new(SftpPoolSlot {
                    opened_for: AtomicU64::new(0),
                    client: Mutex::new(None),
                })
            })
            .clone()
    };
    let mut guard = slot.client.lock().await;
    if prepare_pooled_client(&slot, &mut guard, generation) {
        let info = open_sftp(key.clone())
            .await
            .map_err(|err| map_transport(&ssh.hostname, err))?;
        let stdio = take_channel_stdio(&info.channel_id)
            .await
            .map_err(|err| map_transport(&ssh.hostname, err))?;
        let client = SftpClient::connect(stdio, ssh.hostname.clone()).await?;
        *guard = Some(client);
        slot.opened_for.store(generation, Ordering::SeqCst);
    }
    let client = guard.as_mut().expect("sftp client");
    match f(client).await {
        Err(err) if is_transport_err(&err, &ssh.hostname) => {
            drop_client(&slot, &mut guard);
            Err(ensure_unreachable(&ssh.hostname, err))
        }
        other => other,
    }
}

async fn sftp_atomic_write(
    client: &mut SftpClient,
    path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    #[cfg(test)]
    {
        let force = FORCE_WRITE_SIZE_MISMATCH.swap(false, Ordering::SeqCst);
        client.atomic_write(path, bytes, force).await
    }
    #[cfg(not(test))]
    {
        client.atomic_write(path, bytes).await
    }
}

fn map_transport(hostname: &str, err: String) -> String {
    ensure_unreachable(hostname, err)
}

fn is_transport_err(err: &str, hostname: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("is unreachable")
        || lower.contains("not connected")
        || lower.contains("master is dead")
        || lower.contains("ssh channel")
        || lower.contains("sftp channel timed out")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("connection lost")
        || err.contains(&format!("{hostname} is unreachable."))
}

fn ensure_unreachable(hostname: &str, err: String) -> String {
    let prefix = unreachable_err(hostname);
    if err.contains(&prefix) {
        err
    } else {
        format!("{prefix} {err}")
    }
}

async fn real_root(client: &mut SftpClient, ssh: &SshProjectRoot) -> Result<String, String> {
    let resolved = client.realpath(&ssh.remote_path).await?;
    if resolved == "/" || resolved.trim_end_matches('/') == "" {
        return Err(opening_slash_refused(&ssh.hostname));
    }
    Ok(resolved)
}

async fn jail_path(
    client: &mut SftpClient,
    ssh: &SshProjectRoot,
    relative: &str,
) -> Result<String, String> {
    let parts = if relative.is_empty() {
        Vec::new()
    } else {
        validate_relative(relative, &ssh.hostname)?
    };
    let root = real_root(client, ssh).await?;
    let joined = join_remote(&root, &parts);
    match client.lstat(&joined).await {
        Ok(attrs) if attrs.is_symlink() => resolve_symlink(client, ssh, &root, &joined).await,
        Ok(_) => match client.realpath(&joined).await {
            Ok(resolved) => {
                under_root(&root, &resolved, &ssh.hostname)?;
                Ok(resolved)
            }
            Err(_) => {
                under_root(&root, &joined, &ssh.hostname)?;
                Ok(joined)
            }
        },
        Err(err) if err.contains("No such file") => {
            if parent_entry_is_symlink(client, &joined).await? {
                return Err(broken_symlink_err(&ssh.hostname));
            }
            jail_missing(client, ssh, &root, &joined).await
        }
        Err(err) => Err(err),
    }
}

async fn resolve_symlink(
    client: &mut SftpClient,
    ssh: &SshProjectRoot,
    root: &str,
    path: &str,
) -> Result<String, String> {
    match client.realpath(path).await {
        Ok(resolved) => {
            under_root(root, &resolved, &ssh.hostname)?;
            match client.lstat(&resolved).await {
                Ok(_) => Ok(resolved),
                Err(err) if err.contains("No such file") => Err(broken_symlink_err(&ssh.hostname)),
                Err(err) => Err(err),
            }
        }
        Err(err) if err.contains("No such file") => Err(broken_symlink_err(&ssh.hostname)),
        Err(err) => Err(err),
    }
}

async fn parent_entry_is_symlink(client: &mut SftpClient, path: &str) -> Result<bool, String> {
    let Some(parent) = parent_owned(path) else {
        return Ok(false);
    };
    let name = path.rsplit('/').next().unwrap_or(path);
    match client.readdir(&parent).await {
        Ok(entries) => Ok(entries
            .iter()
            .any(|entry| entry.name == name && entry.attrs.is_symlink())),
        Err(_) => Ok(false),
    }
}

async fn jail_missing(
    client: &mut SftpClient,
    ssh: &SshProjectRoot,
    root: &str,
    joined: &str,
) -> Result<String, String> {
    let mut probe = joined.to_string();
    loop {
        match parent_owned(&probe) {
            Some(parent) => match client.realpath(&parent).await {
                Ok(resolved_parent) => {
                    under_root(root, &resolved_parent, &ssh.hostname)?;
                    let suffix = &joined[parent.len()..];
                    let candidate = if resolved_parent == "/" {
                        suffix.to_string()
                    } else {
                        format!("{resolved_parent}{suffix}")
                    };
                    under_root(root, &candidate, &ssh.hostname)?;
                    return Ok(candidate);
                }
                Err(err) if err.contains("No such file") => {
                    probe = parent;
                    continue;
                }
                Err(err) => return Err(err),
            },
            None => {
                under_root(root, joined, &ssh.hostname)?;
                return Ok(joined.to_string());
            }
        }
    }
}

fn parent_owned(path: &str) -> Option<String> {
    if path == "/" || path.is_empty() {
        return None;
    }
    match path.rfind('/') {
        Some(0) => Some("/".to_string()),
        Some(index) => Some(path[..index].to_string()),
        None => None,
    }
}

async fn classify_open(
    client: &mut SftpClient,
    ssh: &SshProjectRoot,
    path: &str,
) -> Result<Attrs, String> {
    let lstat = match client.lstat(path).await {
        Ok(attrs) => attrs,
        Err(err) if err.contains("No such file") => {
            return Err(format!("No such file on {}.", ssh.hostname));
        }
        Err(err) => return Err(err),
    };
    if lstat.is_special() {
        return Err(not_regular_err(&ssh.hostname));
    }
    if lstat.is_symlink() || (!lstat.is_regular_file() && !lstat.is_dir()) {
        match client.stat(path).await {
            Ok(attrs) => {
                if attrs.is_special() {
                    return Err(not_regular_err(&ssh.hostname));
                }
                if attrs.is_dir() {
                    return Ok(attrs);
                }
                if !attrs.is_regular_file() {
                    return Err(not_regular_err(&ssh.hostname));
                }
                let resolved = client.realpath(path).await.map_err(|err| {
                    if err.contains("No such file") {
                        broken_symlink_err(&ssh.hostname)
                    } else {
                        err
                    }
                })?;
                let root = real_root(client, ssh).await?;
                under_root(&root, &resolved, &ssh.hostname)?;
                Ok(attrs)
            }
            Err(err) if err.contains("No such file") => Err(broken_symlink_err(&ssh.hostname)),
            Err(err) => Err(err),
        }
    } else {
        Ok(lstat)
    }
}

fn image_mime_type(path: &str) -> Option<&'static str> {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn slice_lines(content: &str, offset: Option<u32>, limit: Option<u32>) -> (String, u32, u32, u32) {
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len() as u32;
    let start = (offset.unwrap_or(1).saturating_sub(1) as usize).min(lines.len());
    let max = limit.unwrap_or(total_lines.max(1)) as usize;
    let end = start.saturating_add(max).min(lines.len());
    let slice = lines[start..end].join("\n");
    (slice, total_lines, (start as u32) + 1, (end - start) as u32)
}

fn gate_sensitive(relative: &str, allow_sensitive: Option<bool>) -> Result<(), String> {
    reject_sensitive_path_unless_allowed(relative, allow_sensitive)
}

pub(crate) async fn read_file_await(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    offset: Option<u32>,
    limit: Option<u32>,
    include_base64: Option<bool>,
    allow_sensitive: Option<bool>,
) -> Result<FsReadFileResult, String> {
    match resolve_target(project_root, project_roots, path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh read".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            read_file_ssh(resolved, offset, limit, include_base64).await
        }
    }
}

pub(crate) fn read_file(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    offset: Option<u32>,
    limit: Option<u32>,
    include_base64: Option<bool>,
    allow_sensitive: Option<bool>,
) -> Result<FsReadFileResult, String> {
    let project_root = project_root.to_string();
    let project_roots = project_roots.map(|roots| roots.to_vec());
    let path = path.to_string();
    run(async move {
        read_file_await(
            &project_root,
            project_roots.as_deref(),
            &path,
            offset,
            limit,
            include_base64,
            allow_sensitive,
        )
        .await
    })
}

async fn read_file_ssh(
    resolved: SshResolved,
    offset: Option<u32>,
    limit: Option<u32>,
    include_base64: Option<bool>,
) -> Result<FsReadFileResult, String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            let attrs = classify_open(client, &resolved.ssh, &remote).await?;
            if attrs.is_dir() {
                return Err(not_regular_err(resolved.hostname()));
            }
            if !attrs.is_regular_file() {
                return Err(not_regular_err(resolved.hostname()));
            }
            let bytes = client.read_all(&remote).await?;
            let rel = resolved.reported_path();
            if let Some(mime) = image_mime_type(&remote) {
                if mime == "image/svg+xml" {
                    let content = String::from_utf8(bytes).map_err(|_| {
                        format!("File is not valid UTF-8 on {}.", resolved.hostname())
                    })?;
                    let (slice, total_lines, off, lim) = slice_lines(&content, offset, limit);
                    return Ok(FsReadFileResult {
                        path: rel,
                        content: slice,
                        total_lines,
                        offset: off,
                        limit: lim,
                        is_image: Some(true),
                        mime_type: Some(mime.to_string()),
                        size_bytes: Some(attrs.size.unwrap_or(content.len() as u64)),
                        base64: None,
                    });
                }
                let encoded = if include_base64.unwrap_or(true) {
                    Some(base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        bytes,
                    ))
                } else {
                    None
                };
                return Ok(FsReadFileResult {
                    path: rel,
                    content: String::new(),
                    total_lines: 0,
                    offset: 0,
                    limit: 0,
                    is_image: Some(true),
                    mime_type: Some(mime.to_string()),
                    size_bytes: Some(attrs.size.unwrap_or(0)),
                    base64: encoded,
                });
            }
            let content = String::from_utf8(bytes)
                .map_err(|_| format!("File is not valid UTF-8 on {}.", resolved.hostname()))?;
            let (slice, total_lines, off, lim) = slice_lines(&content, offset, limit);
            Ok(FsReadFileResult {
                path: rel,
                content: slice,
                total_lines,
                offset: off,
                limit: lim,
                is_image: None,
                mime_type: None,
                size_bytes: None,
                base64: None,
            })
        })
    })
    .await
}

pub(crate) async fn list_dir_await(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FsDirEntry>, String> {
    match resolve_target(project_root, project_roots, path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh list".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            list_dir_ssh(resolved).await
        }
    }
}

pub(crate) fn list_dir(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FsDirEntry>, String> {
    let project_root = project_root.to_string();
    let project_roots = project_roots.map(|roots| roots.to_vec());
    let path = path.to_string();
    run(async move {
        list_dir_await(
            &project_root,
            project_roots.as_deref(),
            &path,
            allow_sensitive,
        )
        .await
    })
}

async fn list_dir_ssh(resolved: SshResolved) -> Result<Vec<FsDirEntry>, String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            let attrs = client.lstat(&remote).await?;
            if !attrs.is_dir() {
                return Err(not_directory_err(resolved.hostname()));
            }
            let entries = client.readdir(&remote).await?;
            let mut out = Vec::new();
            for entry in entries {
                if entry.name.contains('\n')
                    || entry.name.contains('\r')
                    || entry.name.contains('\0')
                {
                    continue;
                }
                let child_rel = if resolved.relative.is_empty() {
                    entry.name.clone()
                } else {
                    format!("{}/{}", resolved.relative, entry.name)
                };
                let reported = match &resolved.slug {
                    Some(slug) => format!("{slug}/{child_rel}"),
                    None => child_rel,
                };
                out.push(FsDirEntry {
                    name: entry.name,
                    path: reported,
                    kind: entry.attrs.entry_kind_name(),
                });
            }
            out.sort_by_key(|left| left.name.to_lowercase());
            Ok(out)
        })
    })
    .await
}

pub(crate) async fn list_dir_tree_await(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    max_depth: Option<u32>,
    allow_sensitive: Option<bool>,
) -> Result<FsTreeNode, String> {
    match resolve_target(project_root, project_roots, path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh tree".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            list_dir_tree_ssh(resolved, max_depth.unwrap_or(4)).await
        }
    }
}

pub(crate) fn list_dir_tree(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    max_depth: Option<u32>,
    allow_sensitive: Option<bool>,
) -> Result<FsTreeNode, String> {
    let project_root = project_root.to_string();
    let project_roots = project_roots.map(|roots| roots.to_vec());
    let path = path.to_string();
    run(async move {
        list_dir_tree_await(
            &project_root,
            project_roots.as_deref(),
            &path,
            max_depth,
            allow_sensitive,
        )
        .await
    })
}

async fn list_dir_tree_ssh(resolved: SshResolved, max_depth: u32) -> Result<FsTreeNode, String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            build_tree(client, &resolved, &remote, &resolved.relative, 0, max_depth).await
        })
    })
    .await
}

async fn build_tree(
    client: &mut SftpClient,
    resolved: &SshResolved,
    remote: &str,
    relative: &str,
    depth: u32,
    max_depth: u32,
) -> Result<FsTreeNode, String> {
    let attrs = client.lstat(remote).await?;
    if !attrs.is_dir() && depth == 0 {
        return Err(not_directory_err(resolved.hostname()));
    }
    let name = if relative.is_empty() {
        ".".to_string()
    } else {
        relative.rsplit('/').next().unwrap_or(relative).to_string()
    };
    let reported = match &resolved.slug {
        Some(slug) if relative.is_empty() => slug.clone(),
        Some(slug) => format!("{slug}/{relative}"),
        None => relative.to_string(),
    };
    let children = if attrs.is_dir() && depth < max_depth {
        let mut nodes = Vec::new();
        match client.readdir(remote).await {
            Ok(entries) => {
                for entry in entries {
                    if entry.name.contains('\n')
                        || entry.name.contains('\r')
                        || entry.name.contains('\0')
                    {
                        continue;
                    }
                    let child_rel = if relative.is_empty() {
                        entry.name.clone()
                    } else {
                        format!("{relative}/{}", entry.name)
                    };
                    let child_remote = if remote == "/" {
                        format!("/{}", entry.name)
                    } else {
                        format!("{remote}/{}", entry.name)
                    };
                    match Box::pin(build_tree(
                        client,
                        resolved,
                        &child_remote,
                        &child_rel,
                        depth + 1,
                        max_depth,
                    ))
                    .await
                    {
                        Ok(node) => nodes.push(node),
                        Err(err) if is_transport_err(&err, resolved.hostname()) => {
                            return Err(err);
                        }
                        Err(_) => {}
                    }
                }
            }
            Err(err) if is_transport_err(&err, resolved.hostname()) => return Err(err),
            Err(_) => {}
        }
        nodes.sort_by_key(|left| left.name.to_lowercase());
        Some(nodes)
    } else {
        None
    };
    Ok(FsTreeNode {
        name,
        path: reported,
        kind: attrs.entry_kind_name(),
        children,
    })
}

pub(crate) async fn ensure_ssh_project_directory_await(project_root: &str) -> Result<(), String> {
    let ssh = parse_ssh_project_root(project_root)?;
    ensure_ssh_project_directory_async(ssh).await
}

async fn ensure_ssh_project_directory_async(ssh: SshProjectRoot) -> Result<(), String> {
    with_sftp(&ssh, |client| {
        let ssh = ssh.clone();
        Box::pin(async move {
            let remote = real_root(client, &ssh).await?;
            match client.stat(&remote).await {
                Ok(attrs) if attrs.is_dir() => Ok(()),
                Ok(_) => Err(not_directory_err(&ssh.hostname)),
                Err(err) => Err(err),
            }
        })
    })
    .await
}

pub(crate) async fn stat_await(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    allow_sensitive: Option<bool>,
) -> Result<FsStatResult, String> {
    match resolve_target(project_root, project_roots, path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh stat".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            stat_ssh(resolved).await
        }
    }
}

pub(crate) fn stat(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    allow_sensitive: Option<bool>,
) -> Result<FsStatResult, String> {
    let project_root = project_root.to_string();
    let project_roots = project_roots.map(|roots| roots.to_vec());
    let path = path.to_string();
    run(async move {
        stat_await(
            &project_root,
            project_roots.as_deref(),
            &path,
            allow_sensitive,
        )
        .await
    })
}

async fn stat_ssh(resolved: SshResolved) -> Result<FsStatResult, String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            match client.stat(&remote).await {
                Ok(followed) => {
                    let kind = match client.lstat(&remote).await {
                        Ok(link) => link.entry_kind_name(),
                        Err(_) => followed.entry_kind_name(),
                    };
                    Ok(FsStatResult {
                        path: resolved.reported_path(),
                        exists: true,
                        kind,
                        size: followed.size.unwrap_or(0),
                        modified_ms: followed.modified_ms(),
                    })
                }
                Err(err) if err.contains("No such file") => Ok(FsStatResult {
                    path: resolved.reported_path(),
                    exists: false,
                    kind: "missing".to_string(),
                    size: 0,
                    modified_ms: None,
                }),
                Err(err) => Err(err),
            }
        })
    })
    .await
}

pub(crate) async fn entry_kind_await(
    project_root: &str,
    path: &str,
) -> Result<Option<String>, String> {
    if is_ssh_root(project_root) {
        let stat = stat_await(project_root, None, path, Some(true)).await?;
        if !stat.exists {
            return Ok(None);
        }
        return Ok(Some(stat.kind));
    }
    let root = project_root.to_string();
    let path = path.to_string();
    tauri::async_runtime::spawn_blocking(move || local_entry_kind(&root, &path))
        .await
        .map_err(|error| error.to_string())?
}

fn local_entry_kind(root: &str, path: &str) -> Result<Option<String>, String> {
    match std::fs::metadata(Path::new(root).join(path)) {
        Ok(meta) if meta.is_dir() => Ok(Some("directory".to_string())),
        Ok(meta) if meta.is_file() => Ok(Some("file".to_string())),
        Ok(_) => Ok(Some("other".to_string())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) async fn modified_ms_await(
    project_root: &str,
    path: &str,
) -> Result<Option<u64>, String> {
    if is_ssh_root(project_root) {
        let stat = stat_await(project_root, None, path, Some(true)).await?;
        return Ok(stat.modified_ms);
    }
    let root = project_root.to_string();
    let path = path.to_string();
    tauri::async_runtime::spawn_blocking(move || local_modified_ms(&root, &path))
        .await
        .map_err(|error| error.to_string())?
}

fn local_modified_ms(root: &str, path: &str) -> Result<Option<u64>, String> {
    match std::fs::metadata(Path::new(root).join(path)) {
        Ok(meta) => Ok(meta.modified().ok().and_then(system_time_millis)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn system_time_millis(time: std::time::SystemTime) -> Option<u64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

pub(crate) async fn list_children_await(
    project_root: &str,
    path: &str,
) -> Result<Vec<FsDirEntry>, String> {
    if is_ssh_root(project_root) {
        return list_dir_await(project_root, None, path, Some(true)).await;
    }
    let root = project_root.to_string();
    let path = path.to_string();
    tauri::async_runtime::spawn_blocking(move || local_list_children(&root, &path))
        .await
        .map_err(|error| error.to_string())?
}

fn local_list_children(root: &str, path: &str) -> Result<Vec<FsDirEntry>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(Path::new(root).join(path)).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains('\0') || name.contains('\n') || name.contains('\r') {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let kind = if file_type.is_dir() {
            "directory"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        let child = if path.is_empty() || path == "." {
            name.clone()
        } else {
            format!("{path}/{name}")
        };
        out.push(FsDirEntry {
            name,
            path: child,
            kind: kind.to_string(),
        });
    }
    out.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(out)
}

pub(crate) async fn read_bytes_await(project_root: &str, path: &str) -> Result<Vec<u8>, String> {
    if is_ssh_root(project_root) {
        match resolve_target(project_root, None, path)? {
            FsTarget::Ssh(resolved) => {
                gate_sensitive(&resolved.relative, Some(true))?;
                return read_bytes_ssh(resolved).await;
            }
            FsTarget::Local(_) => {}
        }
    }
    let root = project_root.to_string();
    let path = path.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(Path::new(&root).join(path)).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn read_bytes_ssh(resolved: SshResolved) -> Result<Vec<u8>, String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            let attrs = classify_open(client, &resolved.ssh, &remote).await?;
            if attrs.is_dir() || !attrs.is_regular_file() {
                return Err(not_regular_err(resolved.hostname()));
            }
            client.read_all(&remote).await
        })
    })
    .await
}

pub(crate) async fn write_bytes_await(
    project_root: &str,
    path: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if is_ssh_root(project_root) {
        match resolve_target(project_root, None, path)? {
            FsTarget::Ssh(resolved) => {
                gate_sensitive(&resolved.relative, Some(true))?;
                reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
                return write_bytes_ssh(resolved, bytes).await;
            }
            FsTarget::Local(_) => {}
        }
    }
    let root = project_root.to_string();
    let path = path.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let absolute = Path::new(&root).join(&path);
        if let Some(parent) = absolute.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(absolute, bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn write_bytes_ssh(resolved: SshResolved, bytes: Vec<u8>) -> Result<(), String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            sftp_atomic_write(client, &remote, &bytes).await
        })
    })
    .await
}

pub(crate) async fn ensure_dir_await(project_root: &str, path: &str) -> Result<(), String> {
    if is_ssh_root(project_root) {
        return mkdir_await(project_root.to_string(), None, path.to_string(), Some(true)).await;
    }
    let root = project_root.to_string();
    let path = path.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(Path::new(&root).join(path)).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn write_file(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    content: String,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    run(write_file_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        path.to_string(),
        content,
        allow_sensitive,
    ))
}

pub(crate) async fn write_file_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    path: String,
    content: String,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    match resolve_target(&project_root, project_roots.as_deref(), &path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh write".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
            write_file_ssh(resolved, content).await
        }
    }
}

async fn write_file_ssh(resolved: SshResolved, content: String) -> Result<FileDiff, String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            if let Ok(attrs) = client.lstat(&remote).await {
                if attrs.is_special() {
                    return Err(not_regular_err(resolved.hostname()));
                }
                if attrs.is_symlink() {
                    let followed = client.stat(&remote).await.map_err(|err| {
                        if err.contains("No such file") {
                            broken_symlink_err(resolved.hostname())
                        } else {
                            err
                        }
                    })?;
                    if followed.is_special() || followed.is_dir() {
                        return Err(not_regular_err(resolved.hostname()));
                    }
                    let target = client.realpath(&remote).await.map_err(|err| {
                        if err.contains("No such file") {
                            broken_symlink_err(resolved.hostname())
                        } else {
                            err
                        }
                    })?;
                    let root = real_root(client, &resolved.ssh).await?;
                    under_root(&root, &target, resolved.hostname())?;
                }
            }
            let old_content = match client.read_all(&remote).await {
                Ok(bytes) => Some(String::from_utf8(bytes).map_err(|err| err.to_string())?),
                Err(err) if err.contains("No such file") => None,
                Err(err) => return Err(err),
            };
            sftp_atomic_write(client, &remote, content.as_bytes()).await?;
            let operation = if old_content.is_some() {
                "update"
            } else {
                "create"
            };
            Ok(build_file_diff(
                resolved.reported_path(),
                operation,
                old_content,
                Some(content),
            ))
        })
    })
    .await
}

pub(crate) fn mkdir(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    run(mkdir_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        path.to_string(),
        allow_sensitive,
    ))
}

pub(crate) async fn mkdir_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    path: String,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    match resolve_target(&project_root, project_roots.as_deref(), &path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh mkdir".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
            mkdir_ssh(resolved).await
        }
    }
}

async fn mkdir_ssh(resolved: SshResolved) -> Result<(), String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            client.mkdir_p(&remote).await
        })
    })
    .await
}

pub(crate) fn delete(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    recursive: Option<bool>,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    run(delete_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        path.to_string(),
        recursive,
        allow_sensitive,
    ))
}

pub(crate) async fn delete_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    path: String,
    recursive: Option<bool>,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    match resolve_target(&project_root, project_roots.as_deref(), &path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh delete".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
            delete_ssh(resolved, recursive.unwrap_or(false)).await
        }
    }
}

async fn delete_ssh(resolved: SshResolved, recursive: bool) -> Result<(), String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            let attrs = client.lstat(&remote).await?;
            if attrs.is_dir() {
                if recursive {
                    remove_dir_all(client, &remote).await
                } else {
                    client.rmdir(&remote).await
                }
            } else {
                client.remove(&remote).await
            }
        })
    })
    .await
}

async fn remove_dir_all(client: &mut SftpClient, path: &str) -> Result<(), String> {
    let entries = client.readdir(path).await?;
    for entry in entries {
        let child = if path == "/" {
            format!("/{}", entry.name)
        } else {
            format!("{path}/{}", entry.name)
        };
        if entry.attrs.is_dir() {
            Box::pin(remove_dir_all(client, &child)).await?;
        } else {
            client.remove(&child).await?;
        }
    }
    client.rmdir(path).await
}

pub(crate) fn rename(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    from: &str,
    to: &str,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    run(rename_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        from.to_string(),
        to.to_string(),
        allow_sensitive,
    ))
}

pub(crate) async fn rename_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    from: String,
    to: String,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    let from_target = resolve_target(&project_root, project_roots.as_deref(), &from)?;
    let to_target = resolve_target(&project_root, project_roots.as_deref(), &to)?;
    match (from_target, to_target) {
        (FsTarget::Ssh(from), FsTarget::Ssh(to)) => {
            gate_sensitive(&from.relative, allow_sensitive)?;
            gate_sensitive(&to.relative, allow_sensitive)?;
            reject_git_hooks_write(&from.relative, from.hostname())?;
            reject_git_hooks_write(&to.relative, to.hostname())?;
            if from.ssh.user != to.ssh.user
                || from.ssh.hostname != to.ssh.hostname
                || from.ssh.port != to.ssh.port
            {
                return Err("Move paths must belong to a single project member".to_string());
            }
            rename_ssh(from, to).await
        }
        _ => Err("Rename paths must belong to a single SSH project".to_string()),
    }
}

async fn rename_ssh(from: SshResolved, to: SshResolved) -> Result<(), String> {
    with_sftp(&from.ssh, |client| {
        let from = from.clone();
        let to = to.clone();
        Box::pin(async move {
            let src = jail_path(client, &from.ssh, &from.relative).await?;
            let dest = jail_path(client, &to.ssh, &to.relative).await?;
            match client.lstat(&src).await {
                Err(err) if err.contains("No such file") => {
                    return Err("Source path does not exist".to_string());
                }
                Err(err) => return Err(err),
                Ok(_) => {}
            }
            if client.lstat(&dest).await.is_ok() {
                return Err(format!(
                    "Destination already exists on {}.",
                    from.hostname()
                ));
            }
            if let Some(parent) = parent_owned(&dest) {
                client.mkdir_p(&parent).await?;
            }
            client.rename(&src, &dest).await
        })
    })
    .await
}

pub(crate) fn copy(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    from: &str,
    to: &str,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    run(copy_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        from.to_string(),
        to.to_string(),
        allow_sensitive,
    ))
}

pub(crate) async fn copy_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    from: String,
    to: String,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    let from_target = resolve_target(&project_root, project_roots.as_deref(), &from)?;
    let to_target = resolve_target(&project_root, project_roots.as_deref(), &to)?;
    match (from_target, to_target) {
        (FsTarget::Ssh(from), FsTarget::Ssh(to)) => {
            gate_sensitive(&from.relative, allow_sensitive)?;
            gate_sensitive(&to.relative, allow_sensitive)?;
            reject_git_hooks_write(&from.relative, from.hostname())?;
            reject_git_hooks_write(&to.relative, to.hostname())?;
            copy_ssh(from, to, allow_sensitive).await
        }
        _ => Err("Copy paths must belong to a single SSH project".to_string()),
    }
}

async fn copy_ssh(
    from: SshResolved,
    to: SshResolved,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    with_sftp(&from.ssh, |client| {
        let from = from.clone();
        let to = to.clone();
        Box::pin(async move {
            let src = jail_path(client, &from.ssh, &from.relative).await?;
            let dest_base = jail_path(client, &to.ssh, &to.relative).await?;
            match client.lstat(&src).await {
                Err(err) if err.contains("No such file") => {
                    return Err("Source path does not exist".to_string());
                }
                Err(err) => return Err(err),
                Ok(_) => {}
            }
            let dest = resolve_remote_copy_dest(client, &src, &dest_base).await?;
            if let Some(name) = dest.rsplit('/').next() {
                reject_sensitive_path_unless_allowed(name, allow_sensitive)?;
            }
            if client.lstat(&dest).await.is_ok() {
                return Err(format!(
                    "Destination already exists on {}.",
                    from.hostname()
                ));
            }
            copy_remote(client, &src, &dest).await
        })
    })
    .await
}

async fn resolve_remote_copy_dest(
    client: &mut SftpClient,
    from: &str,
    to: &str,
) -> Result<String, String> {
    match client.lstat(to).await {
        Ok(attrs) if attrs.is_dir() => {
            let name = from.rsplit('/').next().unwrap_or(from);
            if to == "/" {
                Ok(format!("/{name}"))
            } else {
                Ok(format!("{to}/{name}"))
            }
        }
        _ => Ok(to.to_string()),
    }
}

async fn copy_remote(client: &mut SftpClient, from: &str, to: &str) -> Result<(), String> {
    let attrs = client.lstat(from).await?;
    if attrs.is_dir() {
        client.mkdir_p(to).await?;
        for entry in client.readdir(from).await? {
            let child_from = if from == "/" {
                format!("/{}", entry.name)
            } else {
                format!("{from}/{}", entry.name)
            };
            let child_to = if to == "/" {
                format!("/{}", entry.name)
            } else {
                format!("{to}/{}", entry.name)
            };
            Box::pin(copy_remote(client, &child_from, &child_to)).await?;
        }
        Ok(())
    } else {
        if let Some(parent) = parent_owned(to) {
            client.mkdir_p(&parent).await?;
        }
        let bytes = client.read_all(from).await?;
        sftp_atomic_write(client, to, &bytes).await
    }
}

pub(crate) fn move_path(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    from: &str,
    to: &str,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    run(move_path_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        from.to_string(),
        to.to_string(),
        allow_sensitive,
    ))
}

pub(crate) async fn move_path_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    from: String,
    to: String,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    let from_target = resolve_target(&project_root, project_roots.as_deref(), &from)?;
    let to_target = resolve_target(&project_root, project_roots.as_deref(), &to)?;
    match (from_target, to_target) {
        (FsTarget::Ssh(from), FsTarget::Ssh(to)) => {
            if let (Some(a), Some(b)) = (&from.slug, &to.slug) {
                if a != b {
                    return Err("Move paths must belong to a single project member".to_string());
                }
            }
            gate_sensitive(&from.relative, allow_sensitive)?;
            gate_sensitive(&to.relative, allow_sensitive)?;
            reject_git_hooks_write(&from.relative, from.hostname())?;
            reject_git_hooks_write(&to.relative, to.hostname())?;
            move_ssh(from, to, allow_sensitive).await
        }
        _ => Err("Move paths must belong to a single SSH project".to_string()),
    }
}

async fn move_ssh(
    from: SshResolved,
    to: SshResolved,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    with_sftp(&from.ssh, |client| {
        let from = from.clone();
        let to = to.clone();
        Box::pin(async move {
            let src = jail_path(client, &from.ssh, &from.relative).await?;
            let dest_base = jail_path(client, &to.ssh, &to.relative).await?;
            match client.lstat(&src).await {
                Err(err) if err.contains("No such file") => {
                    return Err("Source path does not exist".to_string());
                }
                Err(err) => return Err(err),
                Ok(_) => {}
            }
            let dest = resolve_remote_copy_dest(client, &src, &dest_base).await?;
            if let Some(name) = dest.rsplit('/').next() {
                reject_sensitive_path_unless_allowed(name, allow_sensitive)?;
            }
            if client.lstat(&dest).await.is_ok() {
                return Err(format!(
                    "Destination already exists on {}.",
                    from.hostname()
                ));
            }
            if let Some(parent) = parent_owned(&dest) {
                client.mkdir_p(&parent).await?;
            }
            match client.rename(&src, &dest).await {
                Ok(()) => Ok(()),
                Err(_) => {
                    copy_remote(client, &src, &dest).await?;
                    let attrs = client.lstat(&src).await?;
                    if attrs.is_dir() {
                        remove_dir_all(client, &src).await
                    } else {
                        client.remove(&src).await
                    }
                }
            }
        })
    })
    .await
}

pub(crate) fn edit_file(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    path: &str,
    replacements: Vec<FsEditReplacement>,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    run(edit_file_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        path.to_string(),
        replacements,
        allow_sensitive,
    ))
}

pub(crate) async fn edit_file_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    path: String,
    replacements: Vec<FsEditReplacement>,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    match resolve_target(&project_root, project_roots.as_deref(), &path)? {
        FsTarget::Local(_) => Err("internal: local root routed to ssh edit".to_string()),
        FsTarget::Ssh(resolved) => {
            gate_sensitive(&resolved.relative, allow_sensitive)?;
            reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
            edit_file_ssh(resolved, replacements).await
        }
    }
}

async fn edit_file_ssh(
    resolved: SshResolved,
    replacements: Vec<FsEditReplacement>,
) -> Result<FileDiff, String> {
    with_sftp(&resolved.ssh, |client| {
        let resolved = resolved.clone();
        Box::pin(async move {
            let remote = jail_path(client, &resolved.ssh, &resolved.relative).await?;
            let attrs = classify_open(client, &resolved.ssh, &remote).await?;
            if !attrs.is_regular_file() {
                return Err(not_regular_err(resolved.hostname()));
            }
            let bytes = client.read_all(&remote).await?;
            let old_content = String::from_utf8(bytes)
                .map_err(|_| format!("File is not valid UTF-8 on {}.", resolved.hostname()))?;
            let new_content = super::edit::apply_replacements(&old_content, &replacements)?;
            sftp_atomic_write(client, &remote, new_content.as_bytes()).await?;
            Ok(build_file_diff(
                resolved.reported_path(),
                "update",
                Some(old_content),
                Some(new_content),
            ))
        })
    })
    .await
}

pub(crate) fn apply_patch(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    patch: &str,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    run(apply_patch_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        patch.to_string(),
        allow_sensitive,
    ))
}

pub(crate) async fn apply_patch_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    patch: String,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    apply_patch_ssh(project_root, project_roots, patch, allow_sensitive).await
}

async fn on_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    super::read::off_the_webview(work).await
}

async fn apply_patch_ssh(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    patch: String,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    let operations = super::edit::parse_patch(&patch)?;
    let mut diffs = Vec::new();
    for operation in operations {
        match operation {
            super::edit::PatchOperation::Add { path, content } => {
                match resolve_target(&project_root, project_roots.as_deref(), &path)? {
                    FsTarget::Local(resolved) => {
                        diffs.push(
                            on_blocking(move || {
                                super::edit::apply_local_member(
                                    resolved,
                                    super::edit::PatchOperation::Add { path, content },
                                    allow_sensitive,
                                )
                            })
                            .await?,
                        );
                    }
                    FsTarget::Ssh(resolved) => {
                        gate_sensitive(&resolved.relative, allow_sensitive)?;
                        reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
                        with_sftp(&resolved.ssh, |client| {
                            let resolved = resolved.clone();
                            let content = content.clone();
                            Box::pin(async move {
                                let remote =
                                    jail_path(client, &resolved.ssh, &resolved.relative).await?;
                                sftp_atomic_write(client, &remote, content.as_bytes()).await?;
                                Ok(())
                            })
                        })
                        .await?;
                        diffs.push(build_file_diff(
                            resolved.reported_path(),
                            "create",
                            None,
                            Some(content),
                        ));
                    }
                }
            }
            super::edit::PatchOperation::Update { path, content } => {
                match resolve_target(&project_root, project_roots.as_deref(), &path)? {
                    FsTarget::Local(resolved) => {
                        diffs.push(
                            on_blocking(move || {
                                super::edit::apply_local_member(
                                    resolved,
                                    super::edit::PatchOperation::Update { path, content },
                                    allow_sensitive,
                                )
                            })
                            .await?,
                        );
                    }
                    FsTarget::Ssh(resolved) => {
                        gate_sensitive(&resolved.relative, allow_sensitive)?;
                        reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
                        let (reported, old_content, new_content) =
                            with_sftp(&resolved.ssh, |client| {
                                let resolved = resolved.clone();
                                let content = content.clone();
                                Box::pin(async move {
                                    let remote =
                                        jail_path(client, &resolved.ssh, &resolved.relative)
                                            .await?;
                                    let bytes = client.read_all(&remote).await?;
                                    let old_content = String::from_utf8(bytes).map_err(|_| {
                                        format!(
                                            "File is not valid UTF-8 on {}.",
                                            resolved.hostname()
                                        )
                                    })?;
                                    let new_content =
                                        super::edit::apply_update_patch(&old_content, &content)?;
                                    sftp_atomic_write(client, &remote, new_content.as_bytes())
                                        .await?;
                                    Ok((resolved.reported_path(), old_content, new_content))
                                })
                            })
                            .await?;
                        diffs.push(build_file_diff(
                            reported,
                            "update",
                            Some(old_content),
                            Some(new_content),
                        ));
                    }
                }
            }
            super::edit::PatchOperation::Delete { path } => {
                match resolve_target(&project_root, project_roots.as_deref(), &path)? {
                    FsTarget::Local(resolved) => {
                        diffs.push(
                            on_blocking(move || {
                                super::edit::apply_local_member(
                                    resolved,
                                    super::edit::PatchOperation::Delete { path },
                                    allow_sensitive,
                                )
                            })
                            .await?,
                        );
                    }
                    FsTarget::Ssh(resolved) => {
                        gate_sensitive(&resolved.relative, allow_sensitive)?;
                        reject_git_hooks_write(&resolved.relative, resolved.hostname())?;
                        let (reported, old_content) = with_sftp(&resolved.ssh, |client| {
                            let resolved = resolved.clone();
                            Box::pin(async move {
                                let remote =
                                    jail_path(client, &resolved.ssh, &resolved.relative).await?;
                                let bytes = client.read_all(&remote).await?;
                                let old_content = String::from_utf8(bytes).map_err(|_| {
                                    format!("File is not valid UTF-8 on {}.", resolved.hostname())
                                })?;
                                client.remove(&remote).await?;
                                Ok((resolved.reported_path(), old_content))
                            })
                        })
                        .await?;
                        diffs.push(build_file_diff(reported, "delete", Some(old_content), None));
                    }
                }
            }
        }
    }
    Ok(diffs)
}

pub(crate) fn stage_preview(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    request: FsStagePreviewRequest,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    run(stage_preview_await(
        project_root.to_string(),
        project_roots.map(|roots| roots.to_vec()),
        request,
        allow_sensitive,
    ))
}

pub(crate) async fn stage_preview_await(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    request: FsStagePreviewRequest,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    stage_preview_ssh(project_root, project_roots, request, allow_sensitive).await
}

async fn stage_preview_ssh(
    project_root: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    request: FsStagePreviewRequest,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    let roots = project_roots.as_deref();
    match request {
        FsStagePreviewRequest::Write { path, content } => {
            match resolve_target(&project_root, roots, &path)? {
                FsTarget::Local(resolved) => {
                    on_blocking(move || {
                        super::edit::stage_preview_local_member(
                            resolved,
                            FsStagePreviewRequest::Write { path, content },
                            allow_sensitive,
                        )
                    })
                    .await
                }
                FsTarget::Ssh(resolved) => {
                    gate_sensitive(&resolved.relative, allow_sensitive)?;
                    let old_content = with_sftp(&resolved.ssh, |client| {
                        let resolved = resolved.clone();
                        Box::pin(async move {
                            let remote =
                                jail_path(client, &resolved.ssh, &resolved.relative).await?;
                            match client.read_all(&remote).await {
                                Ok(bytes) => Ok(Some(
                                    String::from_utf8(bytes).map_err(|err| err.to_string())?,
                                )),
                                Err(err) if err.contains("No such file") => Ok(None),
                                Err(err) => Err(err),
                            }
                        })
                    })
                    .await?;
                    let operation = if old_content.is_some() {
                        "update"
                    } else {
                        "create"
                    };
                    Ok(vec![build_file_diff(
                        resolved.reported_path(),
                        operation,
                        old_content,
                        Some(content),
                    )])
                }
            }
        }
        FsStagePreviewRequest::Edit { path, replacements } => {
            if replacements.is_empty() {
                return Err("At least one replacement is required".to_string());
            }
            match resolve_target(&project_root, roots, &path)? {
                FsTarget::Local(resolved) => {
                    on_blocking(move || {
                        super::edit::stage_preview_local_member(
                            resolved,
                            FsStagePreviewRequest::Edit { path, replacements },
                            allow_sensitive,
                        )
                    })
                    .await
                }
                FsTarget::Ssh(resolved) => {
                    gate_sensitive(&resolved.relative, allow_sensitive)?;
                    let old_content = with_sftp(&resolved.ssh, |client| {
                        let resolved = resolved.clone();
                        Box::pin(async move {
                            let remote =
                                jail_path(client, &resolved.ssh, &resolved.relative).await?;
                            let bytes = client.read_all(&remote).await?;
                            String::from_utf8(bytes).map_err(|_| {
                                format!("File is not valid UTF-8 on {}.", resolved.hostname())
                            })
                        })
                    })
                    .await?;
                    let new_content = super::edit::apply_replacements(&old_content, &replacements)?;
                    Ok(vec![build_file_diff(
                        resolved.reported_path(),
                        "update",
                        Some(old_content),
                        Some(new_content),
                    )])
                }
            }
        }
        FsStagePreviewRequest::ApplyPatch { patch } => {
            preview_patch_ssh(&project_root, roots, &patch, allow_sensitive).await
        }
        FsStagePreviewRequest::Delete { path } => {
            match resolve_target(&project_root, roots, &path)? {
                FsTarget::Local(resolved) => {
                    on_blocking(move || {
                        super::edit::stage_preview_local_member(
                            resolved,
                            FsStagePreviewRequest::Delete { path },
                            allow_sensitive,
                        )
                    })
                    .await
                }
                FsTarget::Ssh(resolved) => {
                    gate_sensitive(&resolved.relative, allow_sensitive)?;
                    let old_content = with_sftp(&resolved.ssh, |client| {
                        let resolved = resolved.clone();
                        Box::pin(async move {
                            let remote =
                                jail_path(client, &resolved.ssh, &resolved.relative).await?;
                            let bytes = client.read_all(&remote).await?;
                            String::from_utf8(bytes).map_err(|_| {
                                format!("File is not valid UTF-8 on {}.", resolved.hostname())
                            })
                        })
                    })
                    .await?;
                    Ok(vec![build_file_diff(
                        resolved.reported_path(),
                        "delete",
                        Some(old_content),
                        None,
                    )])
                }
            }
        }
    }
}

async fn preview_patch_ssh(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    patch: &str,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    let operations = super::edit::parse_patch(patch)?;
    let mut diffs = Vec::new();
    for operation in operations {
        match operation {
            super::edit::PatchOperation::Add { path, content } => {
                match resolve_target(project_root, project_roots, &path)? {
                    FsTarget::Local(resolved) => {
                        diffs.push(
                            on_blocking(move || {
                                super::edit::preview_local_member(
                                    resolved,
                                    super::edit::PatchOperation::Add { path, content },
                                    allow_sensitive,
                                )
                            })
                            .await?,
                        );
                    }
                    FsTarget::Ssh(resolved) => {
                        gate_sensitive(&resolved.relative, allow_sensitive)?;
                        diffs.push(build_file_diff(
                            resolved.reported_path(),
                            "create",
                            None,
                            Some(content),
                        ));
                    }
                }
            }
            super::edit::PatchOperation::Update { path, content } => {
                match resolve_target(project_root, project_roots, &path)? {
                    FsTarget::Local(resolved) => {
                        diffs.push(
                            on_blocking(move || {
                                super::edit::preview_local_member(
                                    resolved,
                                    super::edit::PatchOperation::Update { path, content },
                                    allow_sensitive,
                                )
                            })
                            .await?,
                        );
                    }
                    FsTarget::Ssh(resolved) => {
                        gate_sensitive(&resolved.relative, allow_sensitive)?;
                        let old_content = with_sftp(&resolved.ssh, |client| {
                            let resolved = resolved.clone();
                            Box::pin(async move {
                                let remote =
                                    jail_path(client, &resolved.ssh, &resolved.relative).await?;
                                let bytes = client.read_all(&remote).await?;
                                String::from_utf8(bytes).map_err(|_| {
                                    format!("File is not valid UTF-8 on {}.", resolved.hostname())
                                })
                            })
                        })
                        .await?;
                        let new_content = super::edit::apply_update_patch(&old_content, &content)?;
                        diffs.push(build_file_diff(
                            resolved.reported_path(),
                            "update",
                            Some(old_content),
                            Some(new_content),
                        ));
                    }
                }
            }
            super::edit::PatchOperation::Delete { path } => {
                match resolve_target(project_root, project_roots, &path)? {
                    FsTarget::Local(resolved) => {
                        diffs.push(
                            on_blocking(move || {
                                super::edit::preview_local_member(
                                    resolved,
                                    super::edit::PatchOperation::Delete { path },
                                    allow_sensitive,
                                )
                            })
                            .await?,
                        );
                    }
                    FsTarget::Ssh(resolved) => {
                        gate_sensitive(&resolved.relative, allow_sensitive)?;
                        let old_content = with_sftp(&resolved.ssh, |client| {
                            let resolved = resolved.clone();
                            Box::pin(async move {
                                let remote =
                                    jail_path(client, &resolved.ssh, &resolved.relative).await?;
                                let bytes = client.read_all(&remote).await?;
                                String::from_utf8(bytes).map_err(|_| {
                                    format!("File is not valid UTF-8 on {}.", resolved.hostname())
                                })
                            })
                        })
                        .await?;
                        diffs.push(build_file_diff(
                            resolved.reported_path(),
                            "delete",
                            Some(old_content),
                            None,
                        ));
                    }
                }
            }
        }
    }
    Ok(diffs)
}

#[cfg(test)]
pub(crate) fn force_next_write_size_mismatch() {
    FORCE_WRITE_SIZE_MISMATCH.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::super::sftp::size_mismatch_err;
    use super::*;

    #[test]
    fn timed_out_sftp_channel_is_dropped() {
        let err = "eva.local is unreachable. SFTP channel timed out.";
        assert!(is_transport_err(err, "eva.local"));
    }

    #[test]
    fn parse_uri_default_port() {
        let root = parse_ssh_project_root("ssh://aidanhibbard@eva.local/home/aidanhibbard/proj")
            .expect("uri");
        assert_eq!(root.user, "aidanhibbard");
        assert_eq!(root.hostname, "eva.local");
        assert_eq!(root.port, 22);
        assert_eq!(root.remote_path, "/home/aidanhibbard/proj");
    }

    #[test]
    fn parse_uri_custom_port() {
        let root = parse_ssh_project_root("ssh://u@127.0.0.1:2222/tmp/proj").expect("uri");
        assert_eq!(root.port, 2222);
        assert_eq!(root.hostname, "127.0.0.1");
        assert_eq!(root.remote_path, "/tmp/proj");
    }

    #[test]
    fn opening_slash_is_refused() {
        let err = parse_ssh_project_root("ssh://u@eva.local/").expect_err("slash");
        assert_eq!(err, "Opening / on eva.local is refused.");
    }

    #[test]
    fn relative_rejects_parent_nul_and_newline() {
        assert_eq!(
            validate_relative("../etc", "eva.local").unwrap_err(),
            "Path traversal is not allowed"
        );
        assert_eq!(
            validate_relative("/etc/passwd", "eva.local").unwrap_err(),
            "Path must be relative to the project root"
        );
        assert_eq!(
            validate_relative("foo\0bar", "eva.local").unwrap_err(),
            "Name rejected on eva.local."
        );
        assert_eq!(
            validate_relative("foo\nbar", "eva.local").unwrap_err(),
            "Name rejected on eva.local."
        );
    }

    #[test]
    fn size_mismatch_names_host() {
        assert_eq!(
            size_mismatch_err("eva.local"),
            "Size on eva.local does not match the bytes sent."
        );
    }
}
