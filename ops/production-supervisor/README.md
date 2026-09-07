# Production supervisor — canonical tracked copy

This directory is the reviewed, version-controlled source of truth for the three scripts that
implement production crash/reboot supervision (audit finding P0-1). The **executing** copy lives
in `war-room-production\.war-room\` (a git-untracked directory in both `war-room-os` and
`war-room-production` — see each repo's `.gitignore`), because Windows Task Scheduler and
`Start-WarRoom.ps1` both resolve paths relative to that specific checkout, not this one.

Before this directory existed, these three scripts existed ONLY as untracked files on one machine,
in one directory, with no backup — a real single-point-of-failure risk this directory fixes.

**When you edit one of these scripts, edit both copies** (here, for review/history, and in
`war-room-production\.war-room\`, for actual execution) or copy this version over the production
one after review. There is no automation that syncs them for you.

## Files

- `Test-WarRoomHealth.ps1` — read-only health probe. Distinguishes PROCESS_RUNNING /
  PORT_LISTENING / APPLICATION_RESPONDING / OLLAMA_REACHABLE; deliberately reports `councilReady`
  as unknown rather than inferring it from a bare port check (it has no Commander session and does
  not weaken auth to get one).
- `Watchdog-WarRoom.ps1` — the actual crash/reboot decision logic. Bounded backoff (max 5 restarts
  per rolling 30-minute window), logs every restart/backoff decision to
  `.war-room\logs\watchdog.log`, never restarts Ollama itself (separate app, out of scope).
- `Install-WarRoomWatchdogTask.ps1` — registers `Watchdog-WarRoom.ps1` as a Windows Scheduled Task
  (SYSTEM principal, triggers at startup + every 2 minutes). **Requires an elevated (Administrator)
  PowerShell session to run** — it refuses to proceed otherwise rather than silently no-op'ing.

## Status as of 2026-09-06

Registration has **not** been performed — no agent session so far has run elevated, and none
attempted to escalate privileges. To complete this repair, run once, in an Administrator
PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\markb\Documents\Codex\war-room-production\.war-room\Install-WarRoomWatchdogTask.ps1"
```

Safe to re-run — it updates the existing task in place rather than duplicating it.
