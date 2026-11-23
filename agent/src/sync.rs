//! Transactional one-way synchronization: begin → entries → plan → blobs → commit.
//!
//! The journal is the truth across crashes. A workspace with a journal is in `RECOVERY` and
//! refuses leases until the transaction is completed or aborted.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::{digest_of, sha256_hex, Entry, Manifest, Policy};
use crate::workspace::{self, Workspace};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    pub action: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxnRecord {
    #[serde(rename = "txnId")]
    pub txn_id: String,
    pub workspace: String,
    #[serde(rename = "baseGeneration")]
    pub base_generation: u64,
    pub phase: String,
    pub policy: Policy,
    #[serde(default)]
    pub entries: Vec<Entry>,
    #[serde(default, rename = "planDigest")]
    pub plan_digest: Option<String>,
    #[serde(default)]
    pub changes: Vec<Change>,
    #[serde(default)]
    pub needed: Vec<String>,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
}

pub fn begin(
    ws: &Workspace,
    policy: Policy,
    base_generation: u64,
    txn_id: &str,
) -> Result<TxnRecord, String> {
    if ws.recovery.is_some() || workspace::read_journal(&ws.state)?.is_some() {
        return Err("RECOVERY_REQUIRED workspace has an unfinished transaction".into());
    }
    if ws.generation != base_generation {
        return Err(format!(
            "GENERATION_MISMATCH expected {base_generation} actual {}",
            ws.generation
        ));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    let record = TxnRecord {
        txn_id: txn_id.to_string(),
        workspace: ws.id.clone(),
        base_generation,
        phase: "entries".into(),
        policy,
        entries: Vec::new(),
        plan_digest: None,
        changes: Vec::new(),
        needed: Vec::new(),
        started_at: now,
    };
    persist(ws, &record)?;
    Ok(record)
}

pub fn add_entries(
    record: &mut TxnRecord,
    entries: Vec<Entry>,
    ws: &Workspace,
) -> Result<(), String> {
    if record.phase != "entries" {
        return Err("INVALID_REQUEST entries are only accepted before plan".into());
    }
    for entry in entries {
        entry.validate()?;
        if record
            .entries
            .iter()
            .any(|existing| existing.path == entry.path)
        {
            return Err(format!("duplicate entry {}", entry.path));
        }
        record.entries.push(entry);
        if record.entries.len() > 500_000 {
            return Err("RESOURCE_EXHAUSTED manifest exceeds 500000 entries".into());
        }
    }
    persist(ws, record)
}

pub struct PlanResult {
    pub plan_digest: String,
    pub changes: Vec<Change>,
    pub needed: Vec<String>,
}

pub fn plan(record: &mut TxnRecord, ws: &Workspace) -> Result<PlanResult, String> {
    if record.phase != "entries" {
        return Err("INVALID_REQUEST plan already computed".into());
    }
    let policy = record.policy.compile()?;
    let desired = Manifest::from_entries(record.entries.clone())?;

    let old: BTreeMap<&str, &Entry> = ws
        .manifest
        .entries
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let mut changes = Vec::new();
    let mut needed: Vec<String> = Vec::new();
    let mut seen = HashSet::new();

    for entry in &desired.entries {
        if policy.is_excluded(&entry.path, entry.is_dir()) {
            continue;
        }
        seen.insert(entry.path.as_str());
        match old.get(entry.path.as_str()) {
            None => {
                changes.push(Change {
                    action: "add".into(),
                    path: entry.path.clone(),
                });
                if let Some(digest) = &entry.digest {
                    if !blob_path(ws, digest).exists() {
                        needed.push(digest.clone());
                    }
                }
            }
            Some(previous) => {
                if !same_entry(previous, entry) {
                    changes.push(Change {
                        action: "update".into(),
                        path: entry.path.clone(),
                    });
                    if let Some(digest) = &entry.digest {
                        if !blob_path(ws, digest).exists() {
                            needed.push(digest.clone());
                        }
                    }
                }
            }
        }
    }

    if policy.delete_managed {
        for previous in &ws.manifest.entries {
            if seen.contains(previous.path.as_str()) {
                continue;
            }
            if policy.is_excluded(&previous.path, previous.is_dir())
                || policy.is_preserved(&previous.path, previous.is_dir())
            {
                continue;
            }
            changes.push(Change {
                action: "delete".into(),
                path: previous.path.clone(),
            });
        }
    }

    changes.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
    needed.sort();
    needed.dedup();
    let plan_digest = digest_of_changes(&changes);

    record.phase = "planned".into();
    record.plan_digest = Some(plan_digest.clone());
    record.changes = changes.clone();
    record.needed = needed.clone();
    record.entries = desired.entries;
    persist(ws, record)?;
    Ok(PlanResult {
        plan_digest,
        changes,
        needed,
    })
}

fn same_entry(left: &Entry, right: &Entry) -> bool {
    if left.kind != right.kind {
        return false;
    }
    match (left.digest.as_deref(), right.digest.as_deref()) {
        (Some(a), Some(b)) => a == b && left.mode == right.mode,
        _ => left.size == right.size && left.mtime_ms == right.mtime_ms && left.mode == right.mode,
    }
}

fn digest_of_changes(changes: &[Change]) -> String {
    let mut hasher = Sha256::new();
    for change in changes {
        hasher.update(change.action.as_bytes());
        hasher.update(b"\0");
        hasher.update(change.path.as_bytes());
        hasher.update(b"\n");
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

pub fn blob_dir(ws: &Workspace) -> PathBuf {
    ws.state.join("blobs")
}

pub fn blob_path(ws: &Workspace, digest: &str) -> PathBuf {
    let hex = digest.strip_prefix("sha256:").unwrap_or(digest);
    blob_dir(ws).join(hex)
}

#[cfg(test)]
pub fn put_blob(ws: &Workspace, digest: &str, bytes: &[u8]) -> Result<(), String> {
    let actual = format!("sha256:{}", sha256_hex(bytes));
    if actual != digest {
        return Err(format!(
            "BLOB_CORRUPT digest mismatch: expected {digest} got {actual}"
        ));
    }
    let directory = blob_dir(ws);
    fs::create_dir_all(&directory).map_err(io_message)?;
    let target = blob_path(ws, digest);
    if target.exists() {
        return Ok(());
    }
    let temporary = directory.join(format!(".tmp-{}", std::process::id()));
    let mut file = File::create(&temporary).map_err(io_message)?;
    file.write_all(bytes).map_err(io_message)?;
    file.sync_all().map_err(io_message)?;
    fs::rename(&temporary, &target).map_err(io_message)?;
    Ok(())
}

pub fn commit(
    record: &mut TxnRecord,
    ws: &mut Workspace,
    plan_digest: &str,
) -> Result<(u64, String), String> {
    if record.phase != "planned" {
        return Err("INVALID_REQUEST commit requires a planned transaction".into());
    }
    if record.plan_digest.as_deref() != Some(plan_digest) {
        return Err("PLAN_MISMATCH planDigest does not match".into());
    }
    for digest in &record.needed {
        if !blob_path(ws, digest).exists() {
            return Err(format!("BLOB_MISSING {digest}"));
        }
    }
    let desired = Manifest::from_entries(record.entries.clone())?;
    let policy = record.policy.compile()?;

    // The apply phase is recorded first: a crash from here on is recovered by completion.
    record.phase = "applying".into();
    persist(ws, record)?;
    apply(ws, &desired, &record.changes, &policy)?;

    let generation = ws.generation + 1;
    let state = workspace::WorkspaceState {
        root: ws.root.to_string_lossy().to_string(),
        generation,
        manifest_digest: desired.digest.clone(),
    };
    workspace::write_json_atomic(&ws.state.join("manifest.json"), &desired)?;
    workspace::write_json_atomic(&ws.state.join("state.json"), &state)?;
    workspace::clear_journal(&ws.state)?;
    ws.generation = generation;
    ws.manifest = desired;
    ws.recovery = None;
    Ok((generation, digest_of(&ws.manifest.entries)))
}

fn apply(
    ws: &Workspace,
    desired: &Manifest,
    changes: &[Change],
    policy: &crate::model::CompiledPolicy,
) -> Result<(), String> {
    let desired_map: BTreeMap<&str, &Entry> = desired
        .entries
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();

    // Directories first, parents before children.
    let mut directories: Vec<&Entry> = desired
        .entries
        .iter()
        .filter(|entry| entry.is_dir())
        .collect();
    directories.sort_by_key(|entry| entry.path.matches('/').count());
    for entry in directories {
        if policy.is_excluded(&entry.path, true) {
            continue;
        }
        let target = safe_join(&ws.root, &entry.path)?;
        ensure_dir_no_follow(&ws.root, &entry.path)?;
        set_mode(&target, parse_mode(&entry.mode, 0o755))?;
    }

    for change in changes {
        match change.action.as_str() {
            "add" | "update" => {
                let Some(entry) = desired_map.get(change.path.as_str()) else {
                    continue;
                };
                if entry.is_dir() {
                    continue;
                }
                let target = safe_join(&ws.root, &entry.path)?;
                if entry.is_symlink() {
                    if let Ok(metadata) = fs::symlink_metadata(&target) {
                        if metadata.is_dir() && !metadata.file_type().is_symlink() {
                            fs::remove_dir_all(&target).map_err(io_message)?;
                        } else {
                            fs::remove_file(&target).map_err(io_message)?;
                        }
                    }
                    let link = entry.link.clone().unwrap_or_default();
                    std::os::unix::fs::symlink(&link, &target).map_err(io_message)?;
                    continue;
                }
                let digest = entry
                    .digest
                    .clone()
                    .ok_or_else(|| format!("BLOB_MISSING entry {} has no digest", entry.path))?;
                write_file_from_blob(ws, &entry.path, &digest, parse_mode(&entry.mode, 0o644))?;
            }
            "delete" => {
                let target = safe_join(&ws.root, &change.path)?;
                match fs::symlink_metadata(&target) {
                    Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                        // Only empty directories are removed; children are separate changes.
                        let _ = fs::remove_dir(&target);
                    }
                    Ok(_) => {
                        fs::remove_file(&target).map_err(io_message)?;
                    }
                    Err(_) => {}
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn write_file_from_blob(
    ws: &Workspace,
    relative: &str,
    digest: &str,
    mode: u32,
) -> Result<(), String> {
    ensure_parent(&ws.root, relative)?;
    let target = safe_join(&ws.root, relative)?;
    let temporary = target.with_file_name(format!(
        ".fleet-tmp-{}-{}",
        std::process::id(),
        relative.rsplit('/').next().unwrap_or("file")
    ));
    let blob = blob_path(ws, digest);
    let bytes = fs::read(&blob).map_err(|_| format!("BLOB_MISSING {digest}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(io_message)?;
    file.write_all(&bytes).map_err(io_message)?;
    file.sync_all().map_err(io_message)?;
    set_mode(&temporary, mode)?;
    fs::rename(&temporary, &target).map_err(io_message)?;
    if let Some(parent) = target.parent() {
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    Ok(())
}

fn ensure_parent(root: &Path, relative: &str) -> Result<(), String> {
    let parent = match relative.rsplit_once('/') {
        Some((parent, _)) => parent,
        None => return Ok(()),
    };
    ensure_dir_no_follow(root, parent)
}

fn ensure_dir_no_follow(root: &Path, relative: &str) -> Result<(), String> {
    let mut current = root.to_path_buf();
    for segment in relative.split('/') {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(format!("PATH_UNSAFE {relative} traverses a non-directory"));
                }
            }
            Err(_) => {
                fs::create_dir(&current).map_err(io_message)?;
                set_mode(&current, 0o755)?;
            }
        }
    }
    Ok(())
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    crate::model::validate_path(relative)?;
    let mut path = root.to_path_buf();
    let segments: Vec<&str> = relative.split('/').collect();
    for (index, segment) in segments.iter().enumerate() {
        path.push(segment);
        if index + 1 == segments.len() {
            break;
        }
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(format!("PATH_UNSAFE {relative}"));
            }
            _ => {}
        }
    }
    Ok(path)
}

fn parse_mode(mode: &str, default: u32) -> u32 {
    u32::from_str_radix(mode, 8).unwrap_or(default) & 0o7777
}

fn set_mode(path: &Path, mode: u32) -> Result<(), String> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(io_message)
}

fn persist(ws: &Workspace, record: &TxnRecord) -> Result<(), String> {
    let value = serde_json::to_value(record).map_err(|error| error.to_string())?;
    workspace::write_journal(&ws.state, &value)
}

pub fn abort(ws: &Workspace) -> Result<(), String> {
    match workspace::read_journal(&ws.state)? {
        None => Err("OPERATION_UNKNOWN no transaction".into()),
        Some(value) => {
            let record: TxnRecord =
                serde_json::from_value(value).map_err(|error| error.to_string())?;
            if record.phase == "applying" {
                return Err("RECOVERY_REQUIRED commit already started; complete it".into());
            }
            workspace::clear_journal(&ws.state)
        }
    }
}

pub fn inspect(ws: &Workspace) -> Option<TxnRecord> {
    workspace::read_journal(&ws.state)
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_value(value).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::sha256_hex;

    fn temp_workspace(name: &str) -> (PathBuf, PathBuf) {
        let base =
            std::env::temp_dir().join(format!("fleet-agent-test-{}-{}", name, std::process::id()));
        let root = base.join("replica");
        let state = base.join("state");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&state).unwrap();
        std::env::set_var("FLEET_AGENT_STATE_DIR", &state);
        (root, state)
    }

    fn workspace(root: &Path, state: &Path) -> Workspace {
        Workspace {
            id: "test".into(),
            root: root.to_path_buf(),
            state: state.join("test"),
            generation: 0,
            manifest: Manifest::empty(),
            recovery: None,
        }
    }

    fn file_entry(path: &str, content: &str) -> (Entry, String) {
        let digest = format!("sha256:{}", sha256_hex(content.as_bytes()));
        (
            Entry {
                path: path.into(),
                kind: "file".into(),
                mode: "0644".into(),
                size: content.len() as u64,
                mtime_ms: 0,
                digest: Some(digest.clone()),
                link: None,
            },
            digest,
        )
    }

    #[test]
    fn plan_commit_and_idempotent_replan() {
        let (root, state) = temp_workspace("commit");
        fs::create_dir_all(state.join("test")).unwrap();
        let mut ws = workspace(&root, &state);
        let mut txn = begin(&ws, Policy::default(), 0, "txn1").unwrap();
        let (entry, digest) = file_entry("src/app.txt", "hello\n");
        add_entries(&mut txn, vec![entry], &ws).unwrap();
        let result = plan(&mut txn, &ws).unwrap();
        assert_eq!(result.changes.len(), 1);
        assert_eq!(result.needed, vec![digest.clone()]);
        put_blob(&ws, &digest, b"hello\n").unwrap();
        let (generation, _) = commit(&mut txn, &mut ws, &result.plan_digest).unwrap();
        assert_eq!(generation, 1);
        assert_eq!(
            fs::read_to_string(root.join("src/app.txt")).unwrap(),
            "hello\n"
        );

        let mut txn2 = begin(&ws, Policy::default(), 1, "txn2").unwrap();
        let (entry2, _) = file_entry("src/app.txt", "hello\n");
        add_entries(&mut txn2, vec![entry2], &ws).unwrap();
        let result2 = plan(&mut txn2, &ws).unwrap();
        assert!(result2.changes.is_empty());
        abort(&ws).unwrap();
    }

    #[test]
    fn generation_mismatch_is_refused() {
        let (root, state) = temp_workspace("generation");
        let ws = workspace(&root, &state);
        let error = begin(&ws, Policy::default(), 5, "txn").unwrap_err();
        assert!(error.contains("GENERATION_MISMATCH"));
    }

    #[test]
    fn deleted_entries_are_removed_but_preserved_paths_survive() {
        let (root, state) = temp_workspace("delete");
        fs::create_dir_all(state.join("test")).unwrap();
        let mut ws = workspace(&root, &state);
        let mut txn = begin(&ws, Policy::default(), 0, "t1").unwrap();
        let (a, da) = file_entry("a.txt", "a\n");
        let (b, db) = file_entry("target/keep.bin", "keep\n");
        add_entries(&mut txn, vec![a, b], &ws).unwrap();
        let planned = plan(&mut txn, &ws).unwrap();
        put_blob(&ws, &da, b"a\n").unwrap();
        put_blob(&ws, &db, b"keep\n").unwrap();
        commit(&mut txn, &mut ws, &planned.plan_digest).unwrap();

        let policy = Policy {
            excludes: vec![],
            preserve: vec!["target/".into()],
            delete_managed: true,
        };
        let mut txn2 = begin(&ws, policy, 1, "t2").unwrap();
        add_entries(&mut txn2, vec![], &ws).unwrap();
        let planned2 = plan(&mut txn2, &ws).unwrap();
        let deleted: Vec<_> = planned2
            .changes
            .iter()
            .map(|change| change.path.as_str())
            .collect();
        assert_eq!(deleted, vec!["a.txt"]);
        commit(&mut txn2, &mut ws, &planned2.plan_digest).unwrap();
        assert!(!root.join("a.txt").exists());
        assert!(root.join("target/keep.bin").exists());
    }

    #[test]
    fn unsafe_entry_paths_are_rejected_before_apply() {
        let (root, state) = temp_workspace("unsafe");
        let ws = workspace(&root, &state);
        let mut txn = begin(&ws, Policy::default(), 0, "t").unwrap();
        let mut entry = file_entry("ok.txt", "x").0;
        entry.path = "../escape".into();
        assert!(add_entries(&mut txn, vec![entry], &ws).is_err());
    }
}

fn io_message(error: std::io::Error) -> String {
    error.to_string()
}
