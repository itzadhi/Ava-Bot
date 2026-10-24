---
name: ava-pterodactyl
description: Pterodactyl panel runtime constraints, zero-compilation install, cgroup memory limits, log rotation, and graceful shutdown standards.
---

# AVA Pterodactyl Panel Compatibility Guide

## 1. Container Runtime Environment
Pterodactyl Node.js eggs run in restricted Docker containers:
- **Working Directory:** `/home/container` (always use `process.cwd()`, never write outside).
- **Permissions:** Unprivileged user. Zero `sudo`, zero `apt`, zero Docker access, no `git` binary, no `pm2`.
- **Package Installation:** Must succeed with plain `npm install` and **zero C/C++ compilation**.
  - All native libraries must be prebuilt (e.g., `@napi-rs/canvas`).
  - Traditional `node-gyp` packages (like node-canvas `canvas`) fail and are banned.

## 2. Resource Management (CPU & Memory)
Container environments enforce hard RAM quotas (e.g. 512MB, 1GB, 2GB):
- **Inspect cgroup memory limits:**
  - cgroup v2: `/sys/fs/cgroup/memory.max`
  - cgroup v1: `/sys/fs/cgroup/memory/memory.limit_in_bytes`
  - Fallback: `process.env.MEMORY` (in MB)
- **Automatic Cache Management:**
  - Warn at 80% of container memory limit.
  - Trim LRU caches and guild settings caches at 90%.
  - Set default canvas worker concurrency to 1 on small containers (<1GB).

## 3. Graceful Termination & Signals
When stopping or restarting a container from the panel, Pterodactyl sends `SIGINT` or `SIGTERM`:
- Must shut down within **10 seconds** before Pterodactyl issues a `SIGKILL`.
- **Shutdown Sequence:**
  1. Set shutdown flag (reject new incoming gateway jobs).
  2. Stop recurring schedulers (`stopScheduler`, `stopShopExpiryJob`).
  3. Flush pending batched database writes (`batchWriter.destroy()`).
  4. Wait for idle queue (`queue.onIdle()`).
  5. Destroy Discord client connection (`client.destroy()`).
  6. Exit cleanly with code `0`.

## 4. Crash-Loop Protection
If the bot crashes repeatedly within a short window, Discord will reset the bot token or enforce gateway login rate limits:
- If >=3 crashes occur within 5 minutes, enforce exponential backoff before reconnection.
- Persist crash diagnostics to `logs/last-crash.json` with timestamp, exit code, and error trace.

## 5. Console I/O Requirements
Pterodactyl web console renders ANSI colors but behaves poorly with terminal animation controls:
- **Line-based output only:** Flush full lines.
- **No carriage returns (`\r`):** No spinners, no animated progress bars, no curses-like full screen redraws.
- Keep output lines under 120 characters to prevent unwanted line wrapping.
- Respect `NO_COLOR` and `FORCE_COLOR` environment flags.

## 6. How to Test for Pterodactyl Readiness
Run the clean deployment simulation test:
```bash
node scripts/test-pterodactyl.js
```
Verifies:
1. Package dependencies require zero node-gyp builds.
2. Memory limit detector correctly reads simulated container limits.
3. SIGINT/SIGTERM cleans up under 5 seconds.
4. Crash backoff guard successfully creates `logs/last-crash.json`.
