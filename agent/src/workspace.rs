//! Workspace registry, state files and the node-owned lease.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::{Entry, Manifest};

pub const STATE_DIR_MODE: u32 = 0o700;
pub const DEFAULT_LEASE_MS: u64 = 300_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceState {
    pub root: String,
    pub generation: u64,
    #[serde(rename = "manifestDigest")]
    pub manifest_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaseMeta {
    #[serde(rename = "operationId")]
    pub operation_id: String,
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    #[serde(rename = "acquiredAt")]
    pub acquired_at: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
}

pub struct LeaseHandle {
    pub meta: LeaseMeta,
    file: File,
    meta_path: PathBuf,
}

impl LeaseHandle {
    pub fn release(self) {
        let _ = fs::remove_file(&self.meta_path);
        drop(self.file);
    }
}

#[derive(Clone)]
pub struct Workspace {
    pub id: String,
    pub root: PathBuf,
    pub state: PathBuf,
    pub generation: u64,
    pub manifest: Manifest,
    pub recovery: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceProbe {
    pub state: &'static str,
    pub root: String,
    pub generation: u64,
    #[serde(rename = "manifestDigest")]
    pub manifest_digest: String,
    pub recovery: bool,
}

#[derive(Default)]
pub struct Registry {
    workspaces: HashMap<String, Workspace>,
}

impl Registry {
    pub fn get(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Workspace> {
        self.workspaces.get_mut(id)
    }

    pub fn ids(&self) -> Vec<String> {
        self.workspaces.keys().cloned().collect()
    }

    pub fn insert(&mut self, workspace: Workspace) {
        self.workspaces.insert(workspace.id.clone(), workspace);
    }
}

pub fn validate_workspace_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id
            .chars()
            .next()
            .map(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
            .unwrap_or(false)
        && id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || "._-".contains(character)
        });
    if valid {
        Ok(())
    } else {
        Err(format!("invalid workspace id {id:?}"))
    }
}

/// Resolve the nearest existing ancestor and append the missing components.
/// The result is the real path the agent will operate on, not a path alias.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    let mut missing = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        match fs::symlink_metadata(&current) {
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let name = current
                    .file_name()
                    .ok_or_else(|| format!("cannot resolve {}", path.display()))?
                    .to_os_string();
                missing.push(name);
                current = current
                    .parent()
                    .ok_or_else(|| format!("cannot resolve {}", path.display()))?
                    .to_path_buf();
            }
            Err(error) => {
                return Err(format!("cannot resolve {}: {error}", path.display()));
            }
        }
    }
    let mut resolved = fs::canonicalize(&current)
        .map_err(|error| format!("cannot resolve {}: {error}", current.display()))?;
    for component in missing.iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

pub fn resolve_root(input: &str) -> Result<PathBuf, String> {
    let expanded = if let Some(rest) = input.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        PathBuf::from(home).join(rest)
    } else {
        PathBuf::from(input)
    };
    if !expanded.is_absolute() {
        return Err(format!("root {input:?} must be absolute or start with ~/"));
    }
    let normalized = expanded.to_string_lossy().trim_end_matches('/').to_string();
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let home = std::env::var("HOME").unwrap_or_default();
    let home_normalized = home.trim_end_matches('/');
    let forbidden = [
        "/", "/home", "/root", "/usr", "/etc", "/var", "/srv", "/opt", "/bin", "/lib", "/nix",
        "/boot", "/tmp",
    ];
    if parts.len() < 2 || forbidden.contains(&normalized.as_str()) || normalized == home_normalized
    {
        return Err(format!("root {input:?} is too broad for a replica"));
    }
    let canonical = canonicalize_lenient(Path::new(&normalized))?;
    // Re-check the real path: a symlinked alias must not turn a narrow input
    // into a broad or forbidden root.
    let canonical_text = canonical
        .to_string_lossy()
        .trim_end_matches('/')
        .to_string();
    let canonical_parts: Vec<&str> = canonical_text
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    if canonical_parts.len() < 2
        || forbidden.contains(&canonical_text.as_str())
        || canonical_text == home_normalized
    {
        return Err(format!(
            "root {input:?} resolves to a root that is too broad"
        ));
    }
    Ok(canonical)
}

fn same_root(value: &str, root: &Path) -> bool {
    let stored = Path::new(value);
    if stored == root {
        return true;
    }
    canonicalize_lenient(stored)
        .map(|canonical| canonical == root)
        .unwrap_or(false)
}

fn assert_root_unowned(id: &str, root: &Path) -> Result<(), String> {
    let base = state_root();
    let entries = match fs::read_dir(&base) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_message(error)),
    };
    for entry in entries.flatten() {
        let other = entry.file_name().to_string_lossy().to_string();
        if other == id || !entry.path().is_dir() {
            continue;
        }
        let state_file = entry.path().join("state.json");
        let Ok(text) = fs::read_to_string(&state_file) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<WorkspaceState>(&text) else {
            continue;
        };
        if same_root(&value.root, root) {
            return Err(format!(
                "WORKSPACE_ROOT_CONFLICT root {} is already bound to workspace {other}; use a distinct root per workspace",
                root.display()
            ));
        }
    }
    Ok(())
}

pub fn state_root() -> PathBuf {
    if let Some(value) = std::env::var_os("FLEET_AGENT_STATE_DIR") {
        return PathBuf::from(value);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".local/state/fleet-agent/workspaces")
}

/// Refresh a workspace from disk after its lease was acquired, so the caller
/// reads the generation and journal under the lease rather than a stale cache.
pub fn reload_workspace(workspace: &mut Workspace) -> Result<(), String> {
    let state_file = workspace.state.join("state.json");
    let manifest_file = workspace.state.join("manifest.json");
    let value: WorkspaceState =
        serde_json::from_str(&fs::read_to_string(&state_file).map_err(io_message)?)
            .map_err(|error| format!("workspace state is corrupt: {error}"))?;
    if !same_root(&value.root, &workspace.root) {
        return Err(format!(
            "workspace {} is registered at {} not {}",
            workspace.id,
            value.root,
            workspace.root.display()
        ));
    }
    workspace.generation = value.generation;
    workspace.manifest =
        serde_json::from_str(&fs::read_to_string(&manifest_file).map_err(io_message)?)
            .map_err(|error| format!("workspace manifest is corrupt: {error}"))?;
    workspace.recovery = if workspace.state.join("journal.json").exists() {
        Some("applying".into())
    } else {
        None
    };
    Ok(())
}

/// Inspect a workspace without creating its root, state directory or manifest.
pub fn probe_workspace(id: &str, root_input: &str) -> Result<WorkspaceProbe, String> {
    validate_workspace_id(id)?;
    let root = resolve_root(root_input)?;
    assert_root_unowned(id, &root)?;
    let state = state_root().join(id);
    let state_file = state.join("state.json");
    let manifest_file = state.join("manifest.json");
    let journal_file = state.join("journal.json");

    if !state_file.exists() {
        return Ok(WorkspaceProbe {
            state: if root.exists() { "UNMANAGED" } else { "ABSENT" },
            root: root.to_string_lossy().to_string(),
            generation: 0,
            manifest_digest: Manifest::empty().digest,
            recovery: false,
        });
    }

    let value: WorkspaceState =
        serde_json::from_str(&fs::read_to_string(&state_file).map_err(io_message)?)
            .map_err(|error| format!("workspace state is corrupt: {error}"))?;
    if !same_root(&value.root, &root) {
        return Err(format!(
            "workspace {id} is registered at {} not {}",
            value.root,
            root.display()
        ));
    }
    let manifest: Manifest =
        serde_json::from_str(&fs::read_to_string(&manifest_file).map_err(io_message)?)
            .map_err(|error| format!("workspace manifest is corrupt: {error}"))?;
    Ok(WorkspaceProbe {
        state: if journal_file.exists() {
            "RECOVERY"
        } else {
            "READY"
        },
        root: root.to_string_lossy().to_string(),
        generation: value.generation,
        manifest_digest: manifest.digest,
        recovery: journal_file.exists(),
    })
}

/// Resolve a relative path below a root without following symlinks.
///
/// `allow_missing_leaf` is for a file that will be created; every parent must
/// already exist as a real directory. The final component may be absent.
pub fn safe_join(root: &Path, relative: &str, allow_missing_leaf: bool) -> Result<PathBuf, String> {
    crate::model::validate_path(relative)?;
    let segments: Vec<&str> = relative.split('/').collect();
    let mut current = root.to_path_buf();
    for (index, segment) in segments.iter().enumerate() {
        current.push(segment);
        let is_leaf = index + 1 == segments.len();
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(format!("path {relative:?} contains a symlink"));
                }
                if !is_leaf && !metadata.is_dir() {
                    return Err(format!("path {relative:?} has a non-directory parent"));
                }
            }
            Err(error)
                if error.kind() == io::ErrorKind::NotFound && is_leaf && allow_missing_leaf => {}
            Err(error) => {
                return Err(format!(
                    "path {relative:?} is not accessible below the root: {error}"
                ))
            }
        }
    }
    Ok(current)
}

/// Resolve an existing directory below a root and reject symlinks.
pub fn safe_directory(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = safe_join(root, relative, false)?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("path {relative:?} is not accessible: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("path {relative:?} is not a directory"));
    }
    Ok(path)
}

pub fn open_workspace(id: &str, root_input: &str, adopt: bool) -> Result<Workspace, String> {
    validate_workspace_id(id)?;
    let root = resolve_root(root_input)?;
    assert_root_unowned(id, &root)?;
    let state = state_root().join(id);
    ensure_dir(&state)?;
    let state_file = state.join("state.json");
    let manifest_file = state.join("manifest.json");
    let journal_file = state.join("journal.json");

    let exists = root.exists();
    if state_file.exists() {
        let value: WorkspaceState =
            serde_json::from_str(&fs::read_to_string(&state_file).map_err(io_message)?)
                .map_err(|error| format!("workspace state is corrupt: {error}"))?;
        if !same_root(&value.root, &root) {
            return Err(format!(
                "workspace {id} is registered at {} not {}",
                value.root,
                root.display()
            ));
        }
        let manifest: Manifest =
            serde_json::from_str(&fs::read_to_string(&manifest_file).map_err(io_message)?)
                .map_err(|error| format!("workspace manifest is corrupt: {error}"))?;
        let recovery = if journal_file.exists() {
            Some(fs::read_to_string(&journal_file).map_err(io_message)?)
        } else {
            None
        };
        return Ok(Workspace {
            id: id.to_string(),
            root,
            state,
            generation: value.generation,
            manifest,
            recovery,
        });
    }

    if exists && !adopt {
        return Err(format!(
            "{} exists and is not managed; pass adopt=true to take it over",
            root.display()
        ));
    }
    fs::create_dir_all(&root).map_err(io_message)?;
    set_mode(&root, 0o700)?;

    let manifest = if exists {
        scan_manifest(&root)?
    } else {
        Manifest::empty()
    };
    let value = WorkspaceState {
        root: root.to_string_lossy().to_string(),
        generation: 0,
        manifest_digest: manifest.digest.clone(),
    };
    write_json_atomic(&state_file, &value)?;
    write_json_atomic(&manifest_file, &manifest)?;
    Ok(Workspace {
        id: id.to_string(),
        root,
        state,
        generation: 0,
        manifest,
        recovery: None,
    })
}

/// Load a workspace snapshot without creating state, a root or a journal.
/// An absent state and an absent root produce the empty-base manifest.
pub fn preview_workspace(id: &str, root_input: &str) -> Result<Workspace, String> {
    validate_workspace_id(id)?;
    let root = resolve_root(root_input)?;
    assert_root_unowned(id, &root)?;
    let state = state_root().join(id);
    let state_file = state.join("state.json");
    let manifest_file = state.join("manifest.json");
    let journal_file = state.join("journal.json");
    if !state_file.exists() {
        if root.exists() {
            return Err(format!(
                "WORKSPACE_UNMANAGED {} exists and is not managed; apply with adopt=true to take it over",
                root.display()
            ));
        }
        return Ok(Workspace {
            id: id.to_string(),
            root,
            state,
            generation: 0,
            manifest: Manifest::empty(),
            recovery: None,
        });
    }
    let value: WorkspaceState =
        serde_json::from_str(&fs::read_to_string(&state_file).map_err(io_message)?)
            .map_err(|error| format!("workspace state is corrupt: {error}"))?;
    if !same_root(&value.root, &root) {
        return Err(format!(
            "workspace {id} is registered at {} not {}",
            value.root,
            root.display()
        ));
    }
    let manifest: Manifest =
        serde_json::from_str(&fs::read_to_string(&manifest_file).map_err(io_message)?)
            .map_err(|error| format!("workspace manifest is corrupt: {error}"))?;
    let recovery = if journal_file.exists() {
        Some(fs::read_to_string(&journal_file).map_err(io_message)?)
    } else {
        None
    };
    Ok(Workspace {
        id: id.to_string(),
        root,
        state,
        generation: value.generation,
        manifest,
        recovery,
    })
}

/// Take the exclusive node lease. `flock` is released by the kernel when the process dies.
pub fn acquire_lease(
    state: &Path,
    operation_id: &str,
    connection_id: &str,
    ttl_ms: u64,
) -> Result<LeaseHandle, String> {
    ensure_dir(state)?;
    let lock_path = state.join("lease.lock");
    let meta_path = state.join("lease.json");
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(io_message)?;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result != 0 {
        let holder = fs::read_to_string(&meta_path).unwrap_or_default();
        return Err(format!("WORKSPACE_BUSY {holder}"));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    let meta = LeaseMeta {
        operation_id: operation_id.to_string(),
        connection_id: connection_id.to_string(),
        acquired_at: now,
        expires_at: now.saturating_add(ttl_ms),
    };
    write_json_atomic(&meta_path, &meta)?;
    Ok(LeaseHandle {
        meta,
        file,
        meta_path,
    })
}

pub fn write_json_atomic<T: Serialize>(file: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(io_message)?;
    }
    let temporary = file.with_extension(format!("tmp{}", std::process::id()));
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let mut handle = File::create(&temporary).map_err(io_message)?;
    handle.write_all(text.as_bytes()).map_err(io_message)?;
    handle.sync_all().map_err(io_message)?;
    set_mode(&temporary, 0o600)?;
    fs::rename(&temporary, file).map_err(io_message)?;
    if let Some(parent) = file.parent() {
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    Ok(())
}

pub fn read_journal(state: &Path) -> Result<Option<serde_json::Value>, String> {
    let file = state.join("journal.json");
    if !file.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&file).map_err(io_message)?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|error| format!("journal is corrupt: {error}"))
}

pub fn write_journal(state: &Path, value: &serde_json::Value) -> Result<(), String> {
    write_json_atomic(&state.join("journal.json"), value)
}

pub fn clear_journal(state: &Path) -> Result<(), String> {
    let file = state.join("journal.json");
    if file.exists() {
        fs::remove_file(&file).map_err(io_message)?;
    }
    Ok(())
}

fn scan_manifest(root: &Path) -> Result<Manifest, String> {
    let mut entries = Vec::new();
    walk(root, "", &mut entries)?;
    Manifest::from_entries(entries)
}

fn walk(root: &Path, relative: &str, entries: &mut Vec<Entry>) -> Result<(), String> {
    let directory = if relative.is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let mut children: Vec<_> = fs::read_dir(&directory)
        .map_err(io_message)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_message)?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let name = child.file_name().to_string_lossy().to_string();
        let child_relative = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        let metadata = fs::symlink_metadata(child.path()).map_err(io_message)?;
        if metadata.file_type().is_symlink() {
            let target = fs::read_link(child.path()).map_err(io_message)?;
            entries.push(Entry {
                path: child_relative,
                kind: "symlink".into(),
                mode: "0777".into(),
                size: 0,
                mtime_ms: 0,
                digest: None,
                link: Some(target.to_string_lossy().to_string()),
            });
        } else if metadata.is_dir() {
            entries.push(Entry {
                path: child_relative.clone(),
                kind: "dir".into(),
                mode: format!("{:04o}", metadata.permissions().mode() & 0o777),
                size: 0,
                mtime_ms: mtime_ms(&metadata),
                digest: None,
                link: None,
            });
            walk(root, &child_relative, entries)?;
        } else if metadata.is_file() {
            entries.push(Entry {
                path: child_relative,
                kind: "file".into(),
                mode: format!("{:04o}", metadata.permissions().mode() & 0o777),
                size: metadata.len(),
                mtime_ms: mtime_ms(&metadata),
                digest: None,
                link: None,
            });
        }
    }
    Ok(())
}

pub fn mtime_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(io_message)?;
    set_mode(path, STATE_DIR_MODE)
}

fn set_mode(path: &Path, mode: u32) -> Result<(), String> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(io_message)
}

fn io_message(error: io::Error) -> String {
    error.to_string()
}
