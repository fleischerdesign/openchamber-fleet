//! Installation identity and the agent state directory.

use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

pub const DIR_MODE: u32 = 0o700;

pub fn state_root() -> PathBuf {
    if let Some(value) = std::env::var_os("FLEET_AGENT_STATE_DIR") {
        return PathBuf::from(value);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".local/state/fleet-agent")
}

pub fn ensure_state_root() -> io::Result<PathBuf> {
    let root = state_root();
    fs::create_dir_all(&root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(DIR_MODE))?;
    }
    Ok(root)
}

/// Stable per installation. Generated once, then read.
pub fn installation_id() -> io::Result<String> {
    let root = ensure_state_root()?;
    let file = root.join("installation-id");
    if let Ok(value) = fs::read_to_string(&file) {
        let trimmed = value.trim();
        if trimmed.len() == 32 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(trimmed.to_string());
        }
    }
    let id = random_hex_16()?;
    fs::write(&file, format!("{id}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600))?;
    }
    Ok(id)
}

fn random_hex_16() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    match fs::File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes)) {
        Ok(()) => {}
        Err(_) => {
            // Deterministic fallback for exotic platforms; uniqueness is best-effort.
            let seed = format!(
                "{}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|value| value.as_nanos())
                    .unwrap_or(0),
                std::env::var("HOSTNAME")
            );
            let digest = simple_hash(seed.as_bytes());
            bytes.copy_from_slice(&digest);
        }
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn simple_hash(input: &[u8]) -> [u8; 16] {
    let mut state: u128 = 0x9e3779b97f4a7c15;
    for byte in input {
        state ^= *byte as u128;
        state = state.wrapping_mul(0x100000001b3);
        state ^= state >> 29;
    }
    state.to_be_bytes()
}
