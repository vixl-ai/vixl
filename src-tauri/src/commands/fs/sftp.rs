use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use crate::commands::ssh::{close_channel, ChannelStdio};

const SSH_FXP_INIT: u8 = 1;
const SSH_FXP_VERSION: u8 = 2;
const SSH_FXP_OPEN: u8 = 3;
const SSH_FXP_CLOSE: u8 = 4;
const SSH_FXP_READ: u8 = 5;
const SSH_FXP_WRITE: u8 = 6;
const SSH_FXP_LSTAT: u8 = 7;
const SSH_FXP_OPENDIR: u8 = 11;
const SSH_FXP_READDIR: u8 = 12;
const SSH_FXP_REMOVE: u8 = 13;
const SSH_FXP_MKDIR: u8 = 14;
const SSH_FXP_RMDIR: u8 = 15;
const SSH_FXP_REALPATH: u8 = 16;
const SSH_FXP_STAT: u8 = 17;
const SSH_FXP_RENAME: u8 = 18;
const SSH_FXP_STATUS: u8 = 101;
const SSH_FXP_HANDLE: u8 = 102;
const SSH_FXP_DATA: u8 = 103;
const SSH_FXP_NAME: u8 = 104;
const SSH_FXP_ATTRS: u8 = 105;
const SSH_FXP_EXTENDED: u8 = 200;

const SSH_FX_OK: u32 = 0;
const SSH_FX_EOF: u32 = 1;
const SSH_FX_NO_SUCH_FILE: u32 = 2;
const SSH_FX_PERMISSION_DENIED: u32 = 3;
const SSH_FX_FAILURE: u32 = 4;
const SSH_FX_NO_CONNECTION: u32 = 6;
const SSH_FX_CONNECTION_LOST: u32 = 7;
const SSH_FX_FILE_ALREADY_EXISTS: u32 = 11;
const SSH_FX_NO_SPACE_ON_FILESYSTEM: u32 = 14;

const SSH_FILEXFER_ATTR_SIZE: u32 = 0x0000_0001;
const SSH_FILEXFER_ATTR_UIDGID: u32 = 0x0000_0002;
const SSH_FILEXFER_ATTR_PERMISSIONS: u32 = 0x0000_0004;
const SSH_FILEXFER_ATTR_ACMODTIME: u32 = 0x0000_0008;
const SSH_FILEXFER_ATTR_EXTENDED: u32 = 0x8000_0000;

const S_IFMT: u32 = 0o170_000;
const S_IFIFO: u32 = 0o010_000;
const S_IFCHR: u32 = 0o020_000;
const S_IFDIR: u32 = 0o040_000;
const S_IFBLK: u32 = 0o060_000;
const S_IFREG: u32 = 0o100_000;
const S_IFLNK: u32 = 0o120_000;
const S_IFSOCK: u32 = 0o140_000;

const FXF_READ: u32 = 0x0000_0001;
const FXF_WRITE: u32 = 0x0000_0002;
const FXF_CREAT: u32 = 0x0000_0008;
const FXF_TRUNC: u32 = 0x0000_0010;
const FXF_EXCL: u32 = 0x0000_0020;

const MAX_PACKET: usize = 256 * 1024;
const IO_CHUNK: u32 = 32 * 1024;
const PACKET_TIMEOUT: Duration = Duration::from_secs(20);
const SFTP_VERSION: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FileKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Attrs {
    pub size: Option<u64>,
    pub permissions: Option<u32>,
    pub mtime: Option<u32>,
}

impl Attrs {
    pub(crate) fn kind(&self) -> FileKind {
        let Some(mode) = self.permissions else {
            return FileKind::Other;
        };
        match mode & S_IFMT {
            S_IFREG => FileKind::File,
            S_IFDIR => FileKind::Directory,
            S_IFLNK => FileKind::Symlink,
            S_IFIFO | S_IFCHR | S_IFBLK | S_IFSOCK => FileKind::Other,
            _ => FileKind::Other,
        }
    }

    pub(crate) fn is_regular_file(&self) -> bool {
        matches!(self.kind(), FileKind::File)
    }

    pub(crate) fn is_dir(&self) -> bool {
        matches!(self.kind(), FileKind::Directory)
    }

    pub(crate) fn is_symlink(&self) -> bool {
        matches!(self.kind(), FileKind::Symlink)
    }

    pub(crate) fn is_special(&self) -> bool {
        let Some(mode) = self.permissions else {
            return false;
        };
        matches!(mode & S_IFMT, S_IFIFO | S_IFCHR | S_IFBLK | S_IFSOCK)
    }

    pub(crate) fn entry_kind_name(&self) -> String {
        match self.kind() {
            FileKind::Directory => "directory".to_string(),
            FileKind::File => "file".to_string(),
            FileKind::Symlink => "symlink".to_string(),
            FileKind::Other => "other".to_string(),
        }
    }

    pub(crate) fn modified_ms(&self) -> Option<u64> {
        self.mtime.map(|secs| u64::from(secs) * 1000)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct DirEntry {
    pub name: String,
    pub attrs: Attrs,
}

pub(crate) struct SftpClient {
    stdin: ChildStdin,
    stdout: ChildStdout,
    hostname: String,
    next_id: u32,
    extensions: HashSet<String>,
    channel_id: String,
    stderr_text: Arc<Mutex<String>>,
}

impl SftpClient {
    pub(crate) async fn connect(stdio: ChannelStdio, hostname: String) -> Result<Self, String> {
        let stderr_text = Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = stdio.stderr {
            spawn_stderr_drain(stderr, stderr_text.clone());
        }
        let mut client = Self {
            stdin: stdio.stdin,
            stdout: stdio.stdout,
            hostname,
            next_id: 1,
            extensions: HashSet::new(),
            channel_id: stdio.channel_id,
            stderr_text,
        };
        client.handshake().await?;
        Ok(client)
    }

    pub(crate) async fn realpath(&mut self, path: &str) -> Result<String, String> {
        let id = self
            .send(SSH_FXP_REALPATH, |buf| put_str(buf, path))
            .await?;
        let names = self.read_names(id).await?;
        names
            .into_iter()
            .next()
            .map(|entry| entry.name)
            .ok_or_else(|| self.transport_err("SFTP realpath returned no name."))
    }

    pub(crate) async fn lstat(&mut self, path: &str) -> Result<Attrs, String> {
        let id = self.send(SSH_FXP_LSTAT, |buf| put_str(buf, path)).await?;
        self.read_attrs(id).await
    }

    pub(crate) async fn stat(&mut self, path: &str) -> Result<Attrs, String> {
        let id = self.send(SSH_FXP_STAT, |buf| put_str(buf, path)).await?;
        self.read_attrs(id).await
    }

    pub(crate) async fn readdir(&mut self, path: &str) -> Result<Vec<DirEntry>, String> {
        let handle = self.opendir(path).await?;
        let mut entries = Vec::new();
        let result = async {
            loop {
                let id = self
                    .send(SSH_FXP_READDIR, |buf| put_bytes(buf, &handle))
                    .await?;
                match self.read_names_or_eof(id, true).await? {
                    Some(batch) => entries.extend(batch),
                    None => break,
                }
            }
            Ok::<(), String>(())
        }
        .await;
        let close = self.close_handle(&handle).await;
        result.and(close)?;
        Ok(entries
            .into_iter()
            .filter(|entry| entry.name != "." && entry.name != "..")
            .collect())
    }

    pub(crate) async fn read_all(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let handle = self.open_flags(path, FXF_READ).await?;
        let mut data = Vec::new();
        let mut offset = 0u64;
        let result = async {
            loop {
                let id = self
                    .send(SSH_FXP_READ, |buf| {
                        put_bytes(buf, &handle);
                        put_u64(buf, offset);
                        put_u32(buf, IO_CHUNK);
                    })
                    .await?;
                match self.read_data_or_eof(id).await? {
                    Some(chunk) => {
                        if chunk.is_empty() {
                            break;
                        }
                        offset += chunk.len() as u64;
                        data.extend_from_slice(&chunk);
                    }
                    None => break,
                }
            }
            Ok::<(), String>(())
        }
        .await;
        let close = self.close_handle(&handle).await;
        result.and(close)?;
        Ok(data)
    }

    pub(crate) async fn mkdir(&mut self, path: &str) -> Result<(), String> {
        let id = self
            .send(SSH_FXP_MKDIR, |buf| {
                put_str(buf, path);
                put_u32(buf, 0);
            })
            .await?;
        self.read_ok(id).await
    }

    pub(crate) async fn mkdir_p(&mut self, path: &str) -> Result<(), String> {
        if path.is_empty() || path == "/" {
            return Ok(());
        }
        let mut built = String::new();
        for part in path.split('/') {
            if part.is_empty() {
                if built.is_empty() {
                    built.push('/');
                }
                continue;
            }
            if built == "/" {
                built.push_str(part);
            } else if built.is_empty() {
                built.push_str(part);
            } else {
                built.push('/');
                built.push_str(part);
            }
            match self.mkdir(&built).await {
                Ok(()) => {}
                Err(err) => {
                    if err.contains("Destination already exists") {
                        continue;
                    }
                    match self.lstat(&built).await {
                        Ok(attrs) if attrs.is_dir() => {}
                        _ => return Err(err),
                    }
                }
            }
        }
        Ok(())
    }

    pub(crate) async fn remove(&mut self, path: &str) -> Result<(), String> {
        let id = self.send(SSH_FXP_REMOVE, |buf| put_str(buf, path)).await?;
        self.read_ok(id).await
    }

    pub(crate) async fn rmdir(&mut self, path: &str) -> Result<(), String> {
        let id = self.send(SSH_FXP_RMDIR, |buf| put_str(buf, path)).await?;
        self.read_ok(id).await
    }

    pub(crate) async fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        if self.extensions.contains("posix-rename@openssh.com") {
            let id = self
                .send(SSH_FXP_EXTENDED, |buf| {
                    put_str(buf, "posix-rename@openssh.com");
                    put_str(buf, from);
                    put_str(buf, to);
                })
                .await?;
            return self.read_ok(id).await;
        }
        let id = self
            .send(SSH_FXP_RENAME, |buf| {
                put_str(buf, from);
                put_str(buf, to);
            })
            .await?;
        self.read_ok(id).await
    }

    pub(crate) async fn atomic_write(
        &mut self,
        path: &str,
        bytes: &[u8],
        #[cfg(test)] force_size_mismatch: bool,
    ) -> Result<(), String> {
        let parent = parent_dir(path);
        self.mkdir_p(parent).await?;
        let tmp = temp_path(parent);
        let handle = self
            .open_flags(&tmp, FXF_WRITE | FXF_CREAT | FXF_TRUNC | FXF_EXCL)
            .await?;
        let write_err = self.write_handle(&handle, bytes).await.err();
        let fsync_err = if write_err.is_none() {
            self.fsync_handle(&handle).await.err()
        } else {
            None
        };
        let close_err = self.close_handle(&handle).await.err();
        if let Some(err) = write_err.or(fsync_err).or(close_err) {
            let _ = self.remove(&tmp).await;
            return Err(err);
        }
        #[cfg(test)]
        if force_size_mismatch {
            let _ = self.remove(&tmp).await;
            return Err(size_mismatch_err(&self.hostname));
        }
        match self.lstat(&tmp).await {
            Ok(attrs) if attrs.size == Some(bytes.len() as u64) => {}
            Ok(_) => {
                let _ = self.remove(&tmp).await;
                return Err(size_mismatch_err(&self.hostname));
            }
            Err(err) => {
                let _ = self.remove(&tmp).await;
                return Err(err);
            }
        }
        if let Err(err) = self.rename(&tmp, path).await {
            let _ = self.remove(&tmp).await;
            return Err(err);
        }
        let final_attrs = self.stat(path).await?;
        if final_attrs.size != Some(bytes.len() as u64) {
            return Err(size_mismatch_err(&self.hostname));
        }
        Ok(())
    }

    async fn handshake(&mut self) -> Result<(), String> {
        let mut payload = Vec::new();
        put_u32(&mut payload, SFTP_VERSION);
        self.write_packet(SSH_FXP_INIT, &payload).await?;
        let (typ, body) = self
            .read_packet_timed(Duration::from_secs(20))
            .await
            .map_err(|err| self.transport_err(&err))?;
        if typ != SSH_FXP_VERSION {
            return Err(self.transport_err("SFTP version packet was not received."));
        }
        let mut cur = Cursor::new(body);
        let _version = cur.u32()?;
        while cur.remaining() >= 8 {
            let name = cur.string()?;
            let _data = cur.string()?;
            if let Ok(name) = String::from_utf8(name) {
                self.extensions.insert(name);
            }
        }
        Ok(())
    }

    async fn opendir(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let id = self.send(SSH_FXP_OPENDIR, |buf| put_str(buf, path)).await?;
        self.read_handle(id).await
    }

    async fn open_flags(&mut self, path: &str, pflags: u32) -> Result<Vec<u8>, String> {
        let id = self
            .send(SSH_FXP_OPEN, |buf| {
                put_str(buf, path);
                put_u32(buf, pflags);
                put_u32(buf, 0);
            })
            .await?;
        self.read_handle(id).await
    }

    async fn write_handle(&mut self, handle: &[u8], bytes: &[u8]) -> Result<(), String> {
        let mut offset = 0u64;
        while offset < bytes.len() as u64 {
            let start = offset as usize;
            let end = (start + IO_CHUNK as usize).min(bytes.len());
            let id = self
                .send(SSH_FXP_WRITE, |buf| {
                    put_bytes(buf, handle);
                    put_u64(buf, offset);
                    put_bytes(buf, &bytes[start..end]);
                })
                .await?;
            self.read_ok(id).await?;
            offset = end as u64;
        }
        Ok(())
    }

    async fn fsync_handle(&mut self, handle: &[u8]) -> Result<(), String> {
        if !self.extensions.contains("fsync@openssh.com") {
            return Err(format!("Server did not offer fsync on {}.", self.hostname));
        }
        let id = self
            .send(SSH_FXP_EXTENDED, |buf| {
                put_str(buf, "fsync@openssh.com");
                put_bytes(buf, handle);
            })
            .await?;
        self.read_ok(id).await
    }

    async fn close_handle(&mut self, handle: &[u8]) -> Result<(), String> {
        let id = self
            .send(SSH_FXP_CLOSE, |buf| put_bytes(buf, handle))
            .await?;
        self.read_ok(id).await
    }

    async fn send(&mut self, typ: u8, build: impl FnOnce(&mut Vec<u8>)) -> Result<u32, String> {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let mut payload = Vec::new();
        put_u32(&mut payload, id);
        build(&mut payload);
        self.write_packet(typ, &payload).await?;
        Ok(id)
    }

    async fn write_packet(&mut self, typ: u8, payload: &[u8]) -> Result<(), String> {
        let len = 1u32 + payload.len() as u32;
        let mut packet = Vec::with_capacity(4 + payload.len() + 1);
        put_u32(&mut packet, len);
        packet.push(typ);
        packet.extend_from_slice(payload);
        self.stdin
            .write_all(&packet)
            .await
            .map_err(|err| self.transport_err(&err.to_string()))?;
        self.stdin
            .flush()
            .await
            .map_err(|err| self.transport_err(&err.to_string()))
    }

    async fn read_packet_timed(&mut self, timeout: Duration) -> Result<(u8, Vec<u8>), String> {
        tokio::time::timeout(timeout, self.read_packet())
            .await
            .map_err(|_| "SFTP handshake timed out".to_string())?
    }

    async fn read_packet(&mut self) -> Result<(u8, Vec<u8>), String> {
        let mut len_buf = [0u8; 4];
        self.stdout
            .read_exact(&mut len_buf)
            .await
            .map_err(|err| err.to_string())?;
        let len = u32::from_be_bytes(len_buf) as usize;
        if len == 0 || len > MAX_PACKET + 16 {
            return Err(format!("SFTP packet length {len} is invalid"));
        }
        let mut body = vec![0u8; len];
        self.stdout
            .read_exact(&mut body)
            .await
            .map_err(|err| err.to_string())?;
        let typ = body[0];
        Ok((typ, body[1..].to_vec()))
    }

    async fn read_reply(&mut self, id: u32) -> Result<(u8, Vec<u8>), String> {
        let packet = tokio::time::timeout(PACKET_TIMEOUT, self.read_packet()).await;
        let (typ, body) = match packet {
            Ok(Ok(packet)) => packet,
            Ok(Err(err)) => return Err(self.transport_err(&err)),
            Err(_) => return Err(self.transport_err("SFTP channel timed out.")),
        };
        let mut cur = Cursor::new(body);
        let got_id = cur.u32()?;
        if got_id != id {
            return Err(self.transport_err(&format!(
                "SFTP request id mismatch: expected {id}, got {got_id}"
            )));
        }
        Ok((typ, cur.rest()))
    }

    async fn read_ok(&mut self, id: u32) -> Result<(), String> {
        let (typ, body) = self.read_reply(id).await?;
        if typ != SSH_FXP_STATUS {
            return Err(self.transport_err("SFTP status packet was not received."));
        }
        self.parse_status(body, false)
    }

    async fn read_handle(&mut self, id: u32) -> Result<Vec<u8>, String> {
        let (typ, body) = self.read_reply(id).await?;
        match typ {
            SSH_FXP_HANDLE => Cursor::new(body).string(),
            SSH_FXP_STATUS => {
                self.parse_status(body, false)?;
                Err(self.transport_err("SFTP handle was missing."))
            }
            other => Err(self.transport_err(&format!("Unexpected SFTP packet {other}"))),
        }
    }

    async fn read_attrs(&mut self, id: u32) -> Result<Attrs, String> {
        let (typ, body) = self.read_reply(id).await?;
        match typ {
            SSH_FXP_ATTRS => Cursor::new(body).attrs(),
            SSH_FXP_STATUS => {
                self.parse_status(body, false)?;
                Err(self.transport_err("SFTP attrs were missing."))
            }
            other => Err(self.transport_err(&format!("Unexpected SFTP packet {other}"))),
        }
    }

    async fn read_names(&mut self, id: u32) -> Result<Vec<DirEntry>, String> {
        match self.read_names_or_eof(id, false).await? {
            Some(names) => Ok(names),
            None => Ok(Vec::new()),
        }
    }

    async fn read_names_or_eof(
        &mut self,
        id: u32,
        skip_invalid_utf8: bool,
    ) -> Result<Option<Vec<DirEntry>>, String> {
        let (typ, body) = self.read_reply(id).await?;
        match typ {
            SSH_FXP_NAME => {
                let mut cur = Cursor::new(body);
                let count = cur.u32()? as usize;
                let mut names = Vec::with_capacity(count);
                for _ in 0..count {
                    let filename = cur.string()?;
                    let _longname = cur.string()?;
                    let attrs = cur.attrs()?;
                    let name = match String::from_utf8(filename) {
                        Ok(name) => name,
                        Err(_) if skip_invalid_utf8 => continue,
                        Err(_) => {
                            return Err(format!("Name is not valid UTF-8 on {}.", self.hostname));
                        }
                    };
                    names.push(DirEntry { name, attrs });
                }
                Ok(Some(names))
            }
            SSH_FXP_STATUS => match self.parse_status(body, true) {
                Ok(()) => Ok(None),
                Err(err) => Err(err),
            },
            other => Err(self.transport_err(&format!("Unexpected SFTP packet {other}"))),
        }
    }

    async fn read_data_or_eof(&mut self, id: u32) -> Result<Option<Vec<u8>>, String> {
        let (typ, body) = self.read_reply(id).await?;
        match typ {
            SSH_FXP_DATA => Ok(Some(Cursor::new(body).string()?)),
            SSH_FXP_STATUS => match self.parse_status(body, true) {
                Ok(()) => Ok(None),
                Err(err) => Err(err),
            },
            other => Err(self.transport_err(&format!("Unexpected SFTP packet {other}"))),
        }
    }

    fn parse_status(&self, body: Vec<u8>, eof_ok: bool) -> Result<(), String> {
        let mut cur = Cursor::new(body);
        let code = cur.u32()?;
        let message = String::from_utf8_lossy(&cur.string().unwrap_or_default()).into_owned();
        match code {
            SSH_FX_OK => Ok(()),
            SSH_FX_EOF if eof_ok => Ok(()),
            SSH_FX_NO_SUCH_FILE => Err(format!("No such file on {}.", self.hostname)),
            SSH_FX_PERMISSION_DENIED => Err(format!("Permission denied on {}.", self.hostname)),
            SSH_FX_NO_SPACE_ON_FILESYSTEM => Err(format!("No space left on {}.", self.hostname)),
            SSH_FX_FILE_ALREADY_EXISTS => {
                Err(format!("Destination already exists on {}.", self.hostname))
            }
            SSH_FX_NO_CONNECTION | SSH_FX_CONNECTION_LOST => {
                Err(format!("{} is unreachable.", self.hostname))
            }
            SSH_FX_FAILURE if looks_like_no_space(&message) => {
                Err(format!("No space left on {}.", self.hostname))
            }
            SSH_FX_FAILURE if looks_like_exists(&message) => {
                Err(format!("Destination already exists on {}.", self.hostname))
            }
            SSH_FX_FAILURE if looks_like_permission(&message) => {
                Err(format!("Permission denied on {}.", self.hostname))
            }
            SSH_FX_EOF => Err(format!("No such file on {}.", self.hostname)),
            _ => {
                if looks_like_no_space(&message) {
                    Err(format!("No space left on {}.", self.hostname))
                } else if message.is_empty() {
                    Err(format!("SFTP failed on {}.", self.hostname))
                } else {
                    Err(format!("{message} on {}.", self.hostname))
                }
            }
        }
    }

    fn transport_err(&self, detail: &str) -> String {
        let stderr = self
            .stderr_text
            .try_lock()
            .ok()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        let mut text = format!("{} is unreachable.", self.hostname);
        if !detail.is_empty() {
            text.push(' ');
            text.push_str(detail);
        }
        let trimmed = stderr.trim();
        if !trimmed.is_empty() {
            text.push(' ');
            text.push_str(trimmed);
        }
        text
    }
}

impl Drop for SftpClient {
    fn drop(&mut self) {
        let channel_id = self.channel_id.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = close_channel(channel_id).await;
            });
        }
    }
}

struct Cursor {
    data: Vec<u8>,
    pos: usize,
}

impl Cursor {
    fn new(data: Vec<u8>) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn rest(self) -> Vec<u8> {
        self.data[self.pos..].to_vec()
    }

    fn u32(&mut self) -> Result<u32, String> {
        if self.remaining() < 4 {
            return Err("SFTP packet is truncated".to_string());
        }
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&self.data[self.pos..self.pos + 4]);
        self.pos += 4;
        Ok(u32::from_be_bytes(buf))
    }

    fn u64(&mut self) -> Result<u64, String> {
        if self.remaining() < 8 {
            return Err("SFTP packet is truncated".to_string());
        }
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self.data[self.pos..self.pos + 8]);
        self.pos += 8;
        Ok(u64::from_be_bytes(buf))
    }

    fn string(&mut self) -> Result<Vec<u8>, String> {
        let len = self.u32()? as usize;
        if self.remaining() < len {
            return Err("SFTP packet is truncated".to_string());
        }
        let start = self.pos;
        self.pos += len;
        Ok(self.data[start..self.pos].to_vec())
    }

    fn attrs(&mut self) -> Result<Attrs, String> {
        let flags = self.u32()?;
        let mut attrs = Attrs::default();
        if flags & SSH_FILEXFER_ATTR_SIZE != 0 {
            attrs.size = Some(self.u64()?);
        }
        if flags & SSH_FILEXFER_ATTR_UIDGID != 0 {
            let _uid = self.u32()?;
            let _gid = self.u32()?;
        }
        if flags & SSH_FILEXFER_ATTR_PERMISSIONS != 0 {
            attrs.permissions = Some(self.u32()?);
        }
        if flags & SSH_FILEXFER_ATTR_ACMODTIME != 0 {
            let _atime = self.u32()?;
            attrs.mtime = Some(self.u32()?);
        }
        if flags & SSH_FILEXFER_ATTR_EXTENDED != 0 {
            let count = self.u32()?;
            for _ in 0..count {
                let _typ = self.string()?;
                let _data = self.string()?;
            }
        }
        Ok(attrs)
    }
}

fn put_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_be_bytes());
}

fn put_u64(buf: &mut Vec<u8>, value: u64) {
    buf.extend_from_slice(&value.to_be_bytes());
}

fn put_str(buf: &mut Vec<u8>, value: &str) {
    put_bytes(buf, value.as_bytes());
}

fn put_bytes(buf: &mut Vec<u8>, value: &[u8]) {
    put_u32(buf, value.len() as u32);
    buf.extend_from_slice(value);
}

fn parent_dir(path: &str) -> &str {
    match path.rfind('/') {
        Some(0) => "/",
        Some(index) => &path[..index],
        None => "",
    }
}

fn temp_path(parent: &str) -> String {
    let id = uuid::Uuid::new_v4();
    if parent.is_empty() || parent == "/" {
        format!("/.vixl-write-{id}")
    } else {
        format!("{parent}/.vixl-write-{id}")
    }
}

pub(crate) fn size_mismatch_err(hostname: &str) -> String {
    format!("Size on {hostname} does not match the bytes sent.")
}

fn looks_like_no_space(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("no space") || lower.contains("enospc") || lower.contains("disk full")
}

fn looks_like_exists(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("already exists") || lower.contains("file exists")
}

fn looks_like_permission(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("permission denied")
}

fn spawn_stderr_drain(mut stderr: ChildStderr, sink: Arc<Mutex<String>>) {
    tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        loop {
            match stderr.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if let Ok(mut text) = sink.try_lock() {
                        text.push_str(&String::from_utf8_lossy(&buf[..count]));
                    }
                }
            }
        }
    });
}
