//! Command execution with bounded, credit-controlled output streams.
//!
//! v1 uses a new session (`setsid`) and process-group termination. A cgroup is a Linux
//! improvement, not a requirement; the limitation is documented in the protocol spec.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::model::JobState;

pub const SPOOL_LIMIT: usize = 8 * 1024 * 1024;
pub const CHUNK: usize = 64 * 1024;
pub const DEFAULT_PATH: &str = "/run/current-system/sw/bin:/usr/local/bin:/usr/bin:/bin";

#[derive(Debug, Default)]
struct BufferState {
    data: VecDeque<u8>,
    ended: bool,
}

pub struct Buffer {
    state: Mutex<BufferState>,
    not_empty: Condvar,
    not_full: Condvar,
}

impl Buffer {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(BufferState::default()),
            not_empty: Condvar::new(),
            not_full: Condvar::new(),
        })
    }

    pub fn push(&self, bytes: &[u8]) {
        let mut state = self.state.lock().unwrap();
        while state.data.len() >= SPOOL_LIMIT {
            state = self.not_full.wait(state).unwrap();
        }
        state.data.extend(bytes);
        self.not_empty.notify_all();
    }

    pub fn end(&self) {
        let mut state = self.state.lock().unwrap();
        state.ended = true;
        self.not_empty.notify_all();
    }

    /// Take up to `limit` bytes. `None` means the stream ended and is drained.
    pub fn take(&self, limit: usize) -> Option<Vec<u8>> {
        let mut state = self.state.lock().unwrap();
        if state.data.is_empty() {
            if state.ended {
                return None;
            }
            return Some(Vec::new());
        }
        let take = limit.min(state.data.len());
        let bytes: Vec<u8> = state.data.drain(..take).collect();
        self.not_full.notify_all();
        Some(bytes)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRecord {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub workspace: String,
    pub state: JobState,
    #[serde(default)]
    pub pid: Option<i32>,
    #[serde(default, rename = "exitCode")]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub signal: Option<i32>,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
    #[serde(default, rename = "endedAt")]
    pub ended_at: Option<u64>,
    #[serde(rename = "command")]
    pub command: String,
}

impl JobRecord {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            JobState::Succeeded | JobState::Failed | JobState::Cancelled | JobState::Unknown
        )
    }
}

pub struct Job {
    pub record: Arc<Mutex<JobRecord>>,
    pub stdout: Arc<Buffer>,
    pub stderr: Arc<Buffer>,
    child: Arc<Mutex<Child>>,
}

impl Job {
    pub fn cancel(&self, grace_ms: u64) {
        {
            let mut record = self.record.lock().unwrap();
            if matches!(
                record.state,
                JobState::Succeeded | JobState::Failed | JobState::Cancelled | JobState::Unknown
            ) {
                return;
            }
            record.state = JobState::CancelRequested;
        }
        let pid = {
            let child = self.child.lock().unwrap();
            child.id() as i32
        };
        signal_group(pid, libc::SIGTERM);
        let child = self.child.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(grace_ms));
            if let Ok(mut child) = child.lock() {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
            }
            signal_group(pid, libc::SIGKILL);
        });
    }

    pub fn status(&self) -> JobRecord {
        self.record.lock().unwrap().clone()
    }

    /// Best-effort synchronous kill for process teardown. Unlike `cancel`, this does not
    /// spawn a thread: the agent is exiting and the remote work must not outlive its session.
    pub fn terminate_now(&self) {
        let running = self
            .record
            .lock()
            .map(|record| !record.is_terminal())
            .unwrap_or(false);
        if !running {
            return;
        }
        let pid = self
            .child
            .lock()
            .map(|child| child.id() as i32)
            .unwrap_or(0);
        if pid <= 0 {
            return;
        }
        signal_group(pid, libc::SIGTERM);
        thread::sleep(Duration::from_millis(100));
        signal_group(pid, libc::SIGKILL);
    }
}

fn signal_group(pid: i32, signal: i32) {
    unsafe {
        libc::kill(-pid, signal);
    }
}

pub struct SpawnRequest {
    pub job_id: String,
    pub workspace: String,
    pub workspace_root: std::path::PathBuf,
    pub argv: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    pub timeout_ms: Option<u64>,
    pub state_dir: Option<std::path::PathBuf>,
}

pub fn spawn(request: SpawnRequest) -> Result<Job, String> {
    if request.argv.is_empty() {
        return Err("INVALID_REQUEST argv is empty".into());
    }
    let mut command = Command::new(&request.argv[0]);
    command.args(&request.argv[1..]);
    if let Some(cwd) = &request.cwd {
        command.current_dir(request.workspace_root.join(cwd));
    } else {
        command.current_dir(&request.workspace_root);
    }
    command.env_clear();
    command.env("HOME", std::env::var("HOME").unwrap_or_default());
    command.env(
        "PATH",
        std::env::var("PATH").unwrap_or_else(|_| DEFAULT_PATH.to_string()),
    );
    command.env("LANG", "C.UTF-8");
    command.env("TZ", "UTC");
    for (key, value) in &request.env {
        command.env(key, value);
    }
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.stdin(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("PERMISSION_DENIED {error}"))?;
    let pid = child.id() as i32;
    let started_at = now_ms();
    let record = Arc::new(Mutex::new(JobRecord {
        job_id: request.job_id.clone(),
        workspace: request.workspace,
        state: JobState::Running,
        pid: Some(pid),
        exit_code: None,
        signal: None,
        started_at,
        ended_at: None,
        command: request.argv.join(" "),
    }));

    if let Some(state) = &request.state_dir {
        let record = record.lock().unwrap().clone();
        let _ = persist(state, &record);
    }

    let stdout = Buffer::new();
    let stderr = Buffer::new();
    if let Some(pipe) = child.stdout.take() {
        pipe_reader(pipe, stdout.clone(), stderr.clone(), true);
    }
    if let Some(pipe) = child.stderr.take() {
        pipe_reader(pipe, stderr.clone(), stdout.clone(), false);
    }

    let child = Arc::new(Mutex::new(child));
    let wait_child = child.clone();
    let wait_record = record.clone();
    let wait_state = request.state_dir.clone();
    thread::spawn(move || {
        let mut final_status: Option<std::process::ExitStatus> = None;
        loop {
            let status = {
                let mut child = wait_child.lock().unwrap();
                child.try_wait()
            };
            match status {
                Ok(Some(status)) => {
                    final_status = Some(status);
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(20)),
                Err(_) => break,
            }
        }
        let ended_at = now_ms();
        let mut record = wait_record.lock().unwrap();
        record.ended_at = Some(ended_at);
        match final_status {
            Some(status) => {
                if let Some(code) = status.code() {
                    record.exit_code = Some(code);
                    record.state = if record.state == JobState::CancelRequested {
                        JobState::Cancelled
                    } else if code == 0 {
                        JobState::Succeeded
                    } else {
                        JobState::Failed
                    };
                } else {
                    use std::os::unix::process::ExitStatusExt;
                    record.signal = status.signal();
                    record.state = JobState::Cancelled;
                }
            }
            None => record.state = JobState::Unknown,
        }
        if let Some(state) = &wait_state {
            let _ = persist(state, &record);
        }
    });

    if let Some(timeout_ms) = request.timeout_ms {
        let record = record.clone();
        let child = child.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(timeout_ms));
            let running = {
                let record = record.lock().unwrap();
                !matches!(
                    record.state,
                    JobState::Succeeded
                        | JobState::Failed
                        | JobState::Cancelled
                        | JobState::Unknown
                )
            };
            if running {
                let pid = child.lock().unwrap().id() as i32;
                signal_group(pid, libc::SIGTERM);
                thread::sleep(Duration::from_millis(2000));
                signal_group(pid, libc::SIGKILL);
            }
        });
    }

    Ok(Job {
        record,
        stdout,
        stderr,
        child,
    })
}

fn pipe_reader<R: Read + Send + 'static>(
    mut pipe: R,
    buffer: Arc<Buffer>,
    _other: Arc<Buffer>,
    _is_stdout: bool,
) {
    thread::spawn(move || {
        let mut chunk = [0u8; CHUNK];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => buffer.push(&chunk[..read]),
                Err(_) => break,
            }
        }
        buffer.end();
    });
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// Persist a job record next to the workspace state.
pub fn persist(state: &std::path::Path, record: &JobRecord) -> Result<(), String> {
    let directory = state.join("jobs");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let file = directory.join(format!("{}.json", record.job_id));
    let text = serde_json::to_string_pretty(record).map_err(|error| error.to_string())?;
    let temporary = file.with_extension("tmp");
    let mut handle = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
    handle
        .write_all(text.as_bytes())
        .map_err(|error| error.to_string())?;
    handle.sync_all().map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &file).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(argv: Vec<&str>) -> SpawnRequest {
        SpawnRequest {
            job_id: "job1".into(),
            workspace: "ws".into(),
            workspace_root: std::env::temp_dir(),
            argv: argv.into_iter().map(String::from).collect(),
            cwd: None,
            env: Vec::new(),
            timeout_ms: None,
            state_dir: None,
        }
    }

    fn wait_for(job: &Job, deadline_ms: u64) -> JobRecord {
        let start = now_ms();
        loop {
            let record = job.status();
            if matches!(
                record.state,
                JobState::Succeeded | JobState::Failed | JobState::Cancelled | JobState::Unknown
            ) {
                return record;
            }
            if now_ms() - start > deadline_ms {
                panic!("job did not finish: {record:?}");
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn runs_and_captures_output() {
        let job = spawn(request(vec!["sh", "-c", "printf hello; printf err >&2"])).unwrap();
        let record = wait_for(&job, 5000);
        assert_eq!(record.exit_code, Some(0));
        let mut out = Vec::new();
        while let Some(bytes) = job.stdout.take(CHUNK) {
            if bytes.is_empty() && job.stdout.take(0).is_none() {
                break;
            }
            out.extend(bytes);
            if out.len() >= 5 {
                break;
            }
        }
        assert_eq!(String::from_utf8_lossy(&out), "hello");
        let record = job.status();
        persist(&std::env::temp_dir().join("fleet-agent-jobs"), &record).unwrap();
    }

    #[test]
    fn exit_code_is_preserved() {
        let job = spawn(request(vec!["sh", "-c", "exit 7"])).unwrap();
        assert_eq!(wait_for(&job, 5000).exit_code, Some(7));
    }

    #[test]
    fn cancel_terminates_the_process_group() {
        let job = spawn(request(vec!["sh", "-c", "sleep 30"])).unwrap();
        thread::sleep(Duration::from_millis(50));
        job.cancel(200);
        let record = wait_for(&job, 5000);
        assert_eq!(record.state, JobState::Cancelled);
    }

    #[test]
    fn terminate_now_kills_the_process_group() {
        let job = spawn(request(vec!["sh", "-c", "sleep 30"])).unwrap();
        let pid = job.status().pid.unwrap();
        thread::sleep(Duration::from_millis(50));
        job.terminate_now();
        let record = wait_for(&job, 5000);
        assert!(matches!(
            record.state,
            JobState::Cancelled | JobState::Failed
        ));
        thread::sleep(Duration::from_millis(100));
        let alive = unsafe { libc::kill(-pid, 0) } == 0;
        assert!(!alive, "process group {pid} survived terminate_now");
    }

    #[test]
    fn timeout_terminates() {
        let mut req = request(vec!["sh", "-c", "sleep 30"]);
        req.timeout_ms = Some(100);
        let job = spawn(req).unwrap();
        let record = wait_for(&job, 6000);
        assert!(matches!(
            record.state,
            JobState::Cancelled | JobState::Failed
        ));
    }
}

#[cfg(test)]
mod buffer_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn spool_blocks_at_the_limit_until_drained() {
        let buffer = Buffer::new();
        let producer_buffer = buffer.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let producer_finished = finished.clone();
        let producer = thread::spawn(move || {
            let chunk = vec![7u8; CHUNK];
            for _ in 0..(SPOOL_LIMIT / CHUNK + 4) {
                producer_buffer.push(&chunk);
            }
            producer_finished.store(true, Ordering::SeqCst);
        });
        thread::sleep(Duration::from_millis(150));
        assert!(
            !finished.load(Ordering::SeqCst),
            "producer must block at the spool limit"
        );
        let mut drained = 0usize;
        for _ in 0..2000 {
            match buffer.take(CHUNK) {
                Some(bytes) if !bytes.is_empty() => drained += bytes.len(),
                Some(_) => {
                    if finished.load(Ordering::SeqCst) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(5));
                }
                None => break,
            }
        }
        producer.join().unwrap();
        while let Some(bytes) = buffer.take(CHUNK) {
            if bytes.is_empty() {
                break;
            }
            drained += bytes.len();
        }
        assert!(finished.load(Ordering::SeqCst));
        assert!(drained >= SPOOL_LIMIT);
    }
}
