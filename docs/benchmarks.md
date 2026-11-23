# Benchmarks

Measured on `cld-ops-01` (4 vCPU, 15 GB, disk-backed /tmp) with the debug agent binary on the same
host, so controller and agent share CPU and disk. This is a pessimistic bound, not a tuned number.

Command: `FLEET_AGENT_BIN=agent/target/debug/fleet-agent node bench/workspace.mjs --files 200000`

| Phase | 20k files | 50k files | 200k files |
|---|---|---|---|
| scan (controller, SHA-256) | 2.3 s | 6.6 s | 30.3 s |
| apply (entries + plan + commit) | 16.0 s | 37.7 s | 157.7 s |
| verify (empty plan) | 5.1 s | 11.2 s | 56.8 s |
| controller RSS | 535 MiB | 274 MiB | 438 MiB |

The 200k tree uses empty files, so all entries share one blob; this measures manifest handling and
commit file creation (with per-file fsync), not blob throughput. Two scalability defects were found
and fixed while producing these numbers: quadratic duplicate detection in `sync.entries` and
rewriting the whole journal after every page.

Known limits: apply is dominated by per-file fsync; a future batch-commit mode can trade durability
window for speed. Blob upload is one request per unique blob, so a tree of 200k *unique* files would
be limited by round trips.
