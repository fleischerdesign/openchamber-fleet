//! Wire model: manifest entries, policies, plans, job records.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub mode: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default, rename = "mtimeMs")]
    pub mtime_ms: u64,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
}

impl Entry {
    pub fn is_dir(&self) -> bool {
        self.kind == "dir"
    }

    pub fn is_symlink(&self) -> bool {
        self.kind == "symlink"
    }

    pub fn validate(&self) -> Result<(), String> {
        validate_path(&self.path)?;
        match self.kind.as_str() {
            "file" | "dir" | "symlink" => {}
            other => return Err(format!("unknown entry type {other}")),
        }
        if self.is_symlink() && self.link.is_none() {
            return Err("symlink entry without target".into());
        }
        if let Some(digest) = &self.digest {
            if !is_digest(digest) {
                return Err(format!("invalid digest {digest}"));
            }
        }
        Ok(())
    }
}

pub fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.starts_with('/') || path.contains('\0') {
        return Err(format!("unsafe path {path:?}"));
    }
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(format!("unsafe path {path:?}"));
        }
    }
    Ok(())
}

pub fn is_digest(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub entries: Vec<Entry>,
    pub digest: String,
}

impl Manifest {
    pub fn empty() -> Self {
        Self {
            entries: Vec::new(),
            digest: digest_of(&[]),
        }
    }

    pub fn from_entries(mut entries: Vec<Entry>) -> Result<Self, String> {
        entries.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
        let mut previous: Option<&Entry> = None;
        for entry in &entries {
            entry.validate()?;
            if let Some(last) = previous {
                if last.path == entry.path {
                    return Err(format!("duplicate path {}", entry.path));
                }
                if entry.path.starts_with(&format!("{}/", last.path)) && !last.is_dir() {
                    return Err(format!(
                        "{} is a child of a non-directory {}",
                        entry.path, last.path
                    ));
                }
            }
            previous = Some(entry);
        }
        Ok(Self {
            digest: digest_of(&entries),
            entries,
        })
    }
}

pub fn digest_of(entries: &[Entry]) -> String {
    let mut hasher = Sha256::new();
    for entry in entries {
        let size = entry.size.to_string();
        let mtime = entry.mtime_ms.to_string();
        let fields = [
            entry.kind.as_str(),
            entry.path.as_str(),
            entry.mode.as_str(),
            size.as_str(),
            mtime.as_str(),
            entry.digest.as_deref().unwrap_or(""),
            entry.link.as_deref().unwrap_or(""),
        ];
        hasher.update(fields.join("\0").as_bytes());
        hasher.update(b"\n");
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Policy {
    #[serde(default)]
    pub excludes: Vec<String>,
    #[serde(default)]
    pub preserve: Vec<String>,
    #[serde(default = "default_true", rename = "deleteManaged")]
    pub delete_managed: bool,
}

fn default_true() -> bool {
    true
}

impl Policy {
    pub fn compile(&self) -> Result<CompiledPolicy, String> {
        Ok(CompiledPolicy {
            excludes: compile_all(&self.excludes)?,
            preserve: compile_all(&self.preserve)?,
            delete_managed: self.delete_managed,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CompiledPolicy {
    excludes: Vec<Pattern>,
    preserve: Vec<Pattern>,
    pub delete_managed: bool,
}

impl CompiledPolicy {
    pub fn is_excluded(&self, path: &str, is_dir: bool) -> bool {
        matches_with_ancestors(&self.excludes, path, is_dir)
    }

    pub fn is_preserved(&self, path: &str, is_dir: bool) -> bool {
        matches_with_ancestors(&self.preserve, path, is_dir)
    }
}

fn matches_with_ancestors(patterns: &[Pattern], path: &str, is_dir: bool) -> bool {
    let parts: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    for end in 1..=parts.len() {
        let prefix = parts[..end].join("/");
        let prefix_is_dir = end < parts.len() || is_dir;
        if patterns
            .iter()
            .any(|pattern| pattern.matches(&prefix, prefix_is_dir))
        {
            return true;
        }
    }
    false
}

#[derive(Debug, Clone)]
enum Segment {
    AnyDepth,
    Glob(String),
}

#[derive(Debug, Clone)]
struct Pattern {
    anchored: bool,
    dir_only: bool,
    has_slash: bool,
    segments: Vec<Segment>,
}

fn compile_all(patterns: &[String]) -> Result<Vec<Pattern>, String> {
    patterns
        .iter()
        .map(|pattern| {
            compile_pattern(pattern).ok_or_else(|| format!("invalid exclude pattern {pattern:?}"))
        })
        .collect()
}

fn compile_pattern(pattern: &str) -> Option<Pattern> {
    let anchored = pattern.starts_with('/');
    let dir_only = pattern.ends_with('/');
    let body = pattern.trim_start_matches('/').trim_end_matches('/');
    if body.is_empty() || body.split('/').any(|segment| segment == "..") {
        return None;
    }
    let has_slash = body.contains('/');
    let segments = body
        .split('/')
        .map(|segment| {
            if segment == "**" {
                Segment::AnyDepth
            } else {
                Segment::Glob(segment.to_string())
            }
        })
        .collect();
    Some(Pattern {
        anchored,
        dir_only,
        has_slash,
        segments,
    })
}

impl Pattern {
    fn matches(&self, path: &str, is_dir: bool) -> bool {
        if self.dir_only && !is_dir {
            return false;
        }
        let parts: Vec<&str> = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        if self.anchored {
            return match_segments(&self.segments, &parts);
        }
        if self.has_slash
            || self
                .segments
                .iter()
                .any(|segment| matches!(segment, Segment::AnyDepth))
        {
            return (0..parts.len()).any(|start| match_segments(&self.segments, &parts[start..]));
        }
        match parts.last() {
            Some(name) => match_segments(&self.segments, &[name]),
            None => false,
        }
    }
}

fn match_segments(pattern: &[Segment], parts: &[&str]) -> bool {
    match pattern.split_first() {
        None => parts.is_empty(),
        Some((Segment::AnyDepth, rest)) => {
            (0..=parts.len()).any(|take| match_segments(rest, &parts[take..]))
        }
        Some((Segment::Glob(glob), rest)) => match parts.split_first() {
            Some((first, tail)) => glob_match(glob, first) && match_segments(rest, tail),
            None => false,
        },
    }
}

fn glob_match(glob: &str, text: &str) -> bool {
    fn walk(glob: &[char], text: &[char]) -> bool {
        match glob.split_first() {
            None => text.is_empty(),
            Some(('*', rest)) => (0..=text.len()).any(|take| walk(rest, &text[take..])),
            Some(('?', rest)) => !text.is_empty() && walk(rest, &text[1..]),
            Some((expected, rest)) => text.first() == Some(expected) && walk(rest, &text[1..]),
        }
    }
    let glob: Vec<char> = glob.chars().collect();
    let text: Vec<char> = text.chars().collect();
    walk(&glob, &text)
}

// JobState is defined here and used once execution lands.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobState {
    Starting,
    Running,
    CancelRequested,
    Succeeded,
    Failed,
    Cancelled,
    Unknown,
}

#[allow(dead_code)]
impl fmt::Display for JobState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            JobState::Starting => "starting",
            JobState::Running => "running",
            JobState::CancelRequested => "cancel-requested",
            JobState::Succeeded => "succeeded",
            JobState::Failed => "failed",
            JobState::Cancelled => "cancelled",
            JobState::Unknown => "unknown",
        };
        formatter.write_str(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, kind: &str) -> Entry {
        Entry {
            path: path.into(),
            kind: kind.into(),
            mode: if kind == "dir" {
                "0755".into()
            } else {
                "0644".into()
            },
            size: 0,
            mtime_ms: 0,
            digest: if kind == "file" {
                Some(format!("sha256:{}", "0".repeat(64)))
            } else {
                None
            },
            link: if kind == "symlink" {
                Some("target".into())
            } else {
                None
            },
        }
    }

    #[test]
    fn manifest_digest_is_order_independent_after_sorting() {
        let left = Manifest::from_entries(vec![entry("b", "file"), entry("a", "file")]).unwrap();
        let right = Manifest::from_entries(vec![entry("a", "file"), entry("b", "file")]).unwrap();
        assert_eq!(left.digest, right.digest);
        assert_eq!(left.entries[0].path, "a");
    }

    #[test]
    fn duplicate_and_child_paths_are_rejected() {
        assert!(Manifest::from_entries(vec![entry("a", "file"), entry("a", "file")]).is_err());
        assert!(Manifest::from_entries(vec![entry("a", "file"), entry("a/b", "file")]).is_err());
    }

    #[test]
    fn unsafe_paths_are_rejected() {
        for path in ["/abs", "a/../b", "./a", "a//b", ""] {
            assert!(validate_path(path).is_err(), "{path}");
        }
    }

    #[test]
    fn exclude_patterns_match_like_rsync_subset() {
        let policy = Policy {
            excludes: vec![
                "target/".into(),
                "/dist".into(),
                "*.log".into(),
                "build/**".into(),
            ],
            preserve: vec![],
            delete_managed: true,
        }
        .compile()
        .unwrap();
        assert!(policy.is_excluded("target", true));
        assert!(policy.is_excluded("a/target", true));
        assert!(policy.is_excluded("a/target/file", false));
        assert!(!policy.is_excluded("target.txt", false));
        assert!(policy.is_excluded("dist/app", false));
        assert!(!policy.is_excluded("pkg/dist", true));
        assert!(policy.is_excluded("a/b.log", false));
        assert!(policy.is_excluded("build/a/b", false));
        assert!(policy.is_excluded("pkg/build/a", false));
    }

    #[test]
    fn preserve_patterns_do_not_delete_subtrees() {
        let policy = Policy {
            excludes: vec![],
            preserve: vec!["target/".into()],
            delete_managed: true,
        }
        .compile()
        .unwrap();
        assert!(policy.is_preserved("target", true));
        assert!(policy.is_preserved("target/debug/app", false));
        assert!(!policy.is_preserved("src/app", false));
    }
}
