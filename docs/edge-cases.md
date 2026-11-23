# Edge cases

Every row is a statement the implementation must satisfy. Which rows are proven by which test, and
which are planned, is tracked in [`test-coverage.md`](test-coverage.md) — a row is never silently
claimed as tested.

Test prefixes: `U` unit, `P` property, `I` integration (real rsync against a fake SSH transport),
`F` failure injection, `S` security.

## Sync

| ID | Case | Expected | Test |
|---|---|---|---|
| SYNC-01 | Regular file changes | transferred, verify empty | I-01 |
| SYNC-02 | File deleted in canonical | deleted in replica | I-02 |
| SYNC-03 | Directory deleted in canonical | removed if empty after deletion | I-03 |
| SYNC-04 | Excluded directory exists only in replica (`target/`) | untouched, never deleted | I-04, P-02 |
| SYNC-05 | Excluded directory exists in both | neither transferred nor deleted | I-05 |
| SYNC-06 | Symlink to a file inside the tree | recreated as symlink with same target | I-06 |
| SYNC-07 | Relative symlink | target string preserved verbatim | I-07 |
| SYNC-08 | Dangling symlink | preserved, no error | I-08 |
| SYNC-09 | Symlink pointing outside the tree | preserved as a link, never followed | I-09 |
| SYNC-10 | Hardlinked pair | transferred as separate files, content equal | I-10 |
| SYNC-11 | FIFO or socket in the tree | skipped, sync still converges | I-11 |
| SYNC-12 | Executable bit set | preserved | I-12 |
| SYNC-13 | Mode 0600 file | preserved | I-13 |
| SYNC-14 | setuid/setgid bit | preserved or rejected according to `--archive`; documented | I-14 |
| SYNC-15 | File name with spaces | correct path, no shell interpretation | I-15 |
| SYNC-16 | File name with single quote, double quote, `$`, backtick | correct path | I-16 |
| SYNC-17 | File name with newline | transferred; plan parsing survives (itemize mode not used for parsing names from list) | I-17 |
| SYNC-18 | File name beginning with `-` | treated as a path, never as an option (`--` terminator) | I-18 |
| SYNC-19 | Non-ASCII file name (UTF-8) | byte-identical name | I-19 |
| SYNC-20 | Case-only rename on a case-insensitive replica | converges or fails loudly; never half-applied | I-20 |
| SYNC-21 | Empty directory | created in replica | I-21 |
| SYNC-22 | Deep tree (depth > 100) | transferred | I-22 |
| SYNC-23 | Very long path component (255 bytes) | transferred | I-23 |
| SYNC-24 | Large file (> 1 GiB), simulated sparse | transferred; no truncation | I-24 (skipped by default) |
| SYNC-25 | File modified during the walk | revision recomputed after apply; verify decides | F-01 |
| SYNC-26 | Disk full on node | `sync-failed`, replica not marked current | F-02 |
| SYNC-27 | rsync killed mid-transfer | `sync-failed`; second sync converges | F-03 |
| SYNC-28 | Network drop mid-transfer | `sync-failed`; retry converges | F-04 |
| SYNC-29 | Two syncs, same workspace | second waits or `lease-busy`; never interleaved | F-05, U-20 |
| SYNC-30 | Replica removed entirely | plan shows all adds; apply recreates | I-25 |
| SYNC-31 | Canonical path contains spaces | transport unaffected (base64 script, protect-args) | I-26 |
| SYNC-32 | Trailing slash in configured root | normalized exactly once | U-03 |
| SYNC-33 | mtime differs only by sub-second | quick check treats as equal if size matches; documented, `--checksum` available | U-04 |
| SYNC-34 | Same size, different content, same mtime | quick check misses it; `--checksum` catches it | I-27 |
| SYNC-35 | Exclude pattern `target/` | matches a directory named `target` at any depth | U-05 |
| SYNC-36 | Exclude pattern `/dist` | anchored to the workspace root only | U-06 |
| SYNC-37 | Exclude pattern `*.log` | matches basenames at any depth | U-07 |
| SYNC-38 | Exclude pattern with `**` | matches across separators, documented | U-08 |
| SYNC-39 | Excessive excludes (1000) | argv stays under ARG_MAX; chunked if needed | U-09 |
| SYNC-40 | `.git` present | included by default; excluded only if configured | U-10 |
| SYNC-41 | Same-size edit within five seconds of apply | racy guard uses `--checksum` for transfer and verify | I-28 |
| SYNC-42 | Replica root is `/`, a system directory or the home directory | refused before any transfer, `config-invalid` | U-80, I-50 |

## Exec

| ID | Case | Expected | Test |
|---|---|---|---|
| EXEC-01 | Simple command | stdout, exit 0 | I-30 |
| EXEC-02 | Non-zero exit | propagated exactly | I-31 |
| EXEC-03 | Command with spaces and quotes | argv preserved | U-30 |
| EXEC-04 | Command containing a single quote | correctly quoted | U-31 |
| EXEC-05 | Command containing newline | passed verbatim | U-32 |
| EXEC-06 | Raw shell string with pipes and redirects | executed by bash | I-32 |
| EXEC-07 | Caller environment contains a secret | not visible in the child (`env -i`) | S-10 |
| EXEC-08 | Declared env var | visible | I-33 |
| EXEC-09 | PATH is fixed | does not inherit the plugin's PATH | U-33 |
| EXEC-10 | HOME is the remote user's home | `$HOME` correct | I-34 |
| EXEC-11 | Working directory is the replica root | `pwd` equals root | I-35 |
| EXEC-12 | Replica root missing | exit 97, no command executed | I-36 |
| EXEC-13 | Timeout | exit 124, process killed | F-10 |
| EXEC-14 | Command ignores SIGTERM | killed with SIGKILL after grace | F-11 |
| EXEC-15 | Command daemonises | documented as out of scope; parent returns | F-12 |
| EXEC-16 | Interactive command without TTY | fails or exits; never hangs the caller | F-13 |
| EXEC-17 | Output larger than the cap | truncated in the tool result, full log on disk | F-14 |
| EXEC-18 | stderr and stdout interleaved | both captured; ordering preserved per stream | I-37 |
| EXEC-19 | Login shell of the node is fish | unaffected (script is base64 + bash) | I-38 |
| EXEC-20 | Locale-dependent output | fixed `LANG=C.UTF-8`, `TZ=UTC` | U-34 |
| EXEC-21 | Umask on the node | set explicitly (0022) so artifacts are readable | I-39 |
| EXEC-22 | Signal-forwarding from the caller (SIGINT) | local ssh dies, remote pid signalled, lease released | F-15 |
| EXEC-23 | Two execs, same workspace | serialised by lease | F-16 |
| EXEC-24 | `argv` empty | usage error before any ssh call | U-35 |
| EXEC-25 | configured shell missing on the node | exit 98, nothing executed | I-45 |

## Fetch

| ID | Case | Expected | Test |
|---|---|---|---|
| FETCH-01 | Named file | transferred, content equal | I-40 |
| FETCH-02 | Named directory | transferred recursively | I-41 |
| FETCH-03 | Path with `..` | rejected before ssh | S-20 |
| FETCH-04 | Absolute path | rejected | S-21 |
| FETCH-05 | Symlink pointing outside the replica | not followed (`--safe-links`) | S-22 |
| FETCH-06 | Destination exists | error unless `--overwrite` | U-40 |
| FETCH-07 | Glob matching nothing | `artifact-missing`, non-zero | I-42 |
| FETCH-08 | Mode and mtime preserved | yes | I-43 |
| FETCH-09 | `--verify` | sha256 compared, mismatch fails | I-44 |
| FETCH-10 | Empty path list | usage error | U-41 |

## State and concurrency

| ID | Case | Expected | Test |
|---|---|---|---|
| STATE-01 | Fresh state directory | created with 0700 | U-50 |
| STATE-02 | Concurrent writers to `state.json` | atomic rename, no partial JSON | U-51 |
| STATE-03 | Corrupt `state.json` | reported, not silently replaced | U-52 |
| STATE-04 | Lease held by a live pid | `lease-busy` | U-20 |
| STATE-05 | Lease held by a dead pid, not expired | reclaimed after TTL only | U-21 |
| STATE-06 | Lease expired, pid alive | not reclaimed | U-22 |
| STATE-07 | Crash between apply and verify | replica not marked current; next exec verifies | F-20 |
| STATE-08 | Clock skew between caller and node | irrelevant: no timestamps are compared across hosts | U-53 |

## Security

| ID | Case | Expected | Test |
|---|---|---|---|
| SEC-01 | Host key unknown | `host-key-mismatch`, nothing executed | S-01 |
| SEC-02 | Host key changed | failure, not a warning | S-02 |
| SEC-03 | Password authentication offered | never used (`BatchMode=yes`) | S-03 |
| SEC-04 | Command injection through a path | impossible: paths validated and quoted | S-04 |
| SEC-05 | Command injection through host name | host names validated against a safe pattern | S-05 |
| SEC-06 | Environment leak | covered by EXEC-07 | S-10 |
| SEC-07 | Replica readable by other local users | state and replica created 0700 | S-06 |
| SEC-08 | Audit trail | every sync/exec/fetch recorded with digest | S-07 |

## Configuration

| ID | Case | Expected | Test |
|---|---|---|---|
| CFG-01 | `fleet.json` missing | `config-missing`, hint to run `fleet init` | U-60 |
| CFG-02 | Unknown key | error naming the key | U-61 |
| CFG-03 | Invalid workspace name | error naming the pattern | U-62 |
| CFG-04 | Host without `ssh` | error | U-63 |
| CFG-05 | `root` not absolute and not `~/…` | error | U-64 |
| CFG-06 | Duplicate host definitions by alias | allowed; aliases are distinct keys | U-65 |
| CFG-07 | Excludes not an array of strings | error | U-66 |
| CFG-08 | Env value not a string | error | U-67 |

## Portability

| ID | Case | Expected | Test |
|---|---|---|---|
| PORT-01 | rsync < 3.1 on the node | refused with a clear message | U-70 |
| PORT-02 | `base64` missing on the node | failure names the missing tool | F-30 |
| PORT-03 | macOS controller | works (no GNU-only flags on the controller path) | manual |
| PORT-04 | Windows controller | unsupported, documented | — |
| PORT-05 | Node path contains `:` | rejected at config time (rsync remote syntax) | U-71 |

## Test mapping rules

- Every row is either covered (see `test-coverage.md`) or listed there as planned with a reason;
  a new claim arrives with its test in the same commit.
- Property tests cover convergence and idempotence over random trees; the numbered cases cover the
  semantics that property tests cannot name.
- Failure injection uses the fake SSH transport with a real rsync, plus a `PATH` shim that makes
  rsync fail or hang on demand.
