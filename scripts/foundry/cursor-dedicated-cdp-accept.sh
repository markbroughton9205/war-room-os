#!/usr/bin/env bash
# Commander-authorized one-time Cursor relaunch for dedicated loopback CDP.
# Does not kill War Room. Does not rewrite Cursor .desktop files.
set -eu
LOG=/tmp/foundry-cursor-dedicated-cdp-orchestrator.log
REPORT=/tmp/FOUNDRY_CURSOR_DEDICATED_CDP_ACCEPTANCE_REPORT.json
REPO=/home/chosenone/Codex/war-room-os
CURSOR_BIN=/usr/share/cursor/cursor
exec >>"$LOG" 2>&1
echo "=== $(date -Is) orchestrator start pid=$$ ==="
# Give the current Cursor agent turn time to flush before the authorized restart.
sleep 12
sleep 5

war_room_pids() {
  pgrep -f '/opt/War Room OS/war-room-os' | sort -u || true
}

cursor_main_pids() {
  pgrep -af "$CURSOR_BIN" | awk '{print $1}' | sort -u || true
}

WR_BEFORE="$(war_room_pids | tr '\n' ' ')"
echo "war_room_pids_before=$WR_BEFORE"

# Kill only Cursor (and its Chromium children). Never War Room.
mapfile -t CURSOR_PIDS < <(cursor_main_pids)
for pid in "${CURSOR_PIDS[@]:-}"; do
  [ -n "${pid:-}" ] || continue
  if echo " $WR_BEFORE " | grep -q " $pid "; then
    echo "skip war-room pid $pid"
    continue
  fi
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  if echo "$cmd" | grep -qi 'war-room'; then
    echo "skip war-room cmdline pid $pid"
    continue
  fi
  echo "killing cursor pid $pid cmd=$cmd"
  kill "$pid" 2>/dev/null || true
done

for _ in $(seq 1 40); do
  leftover="$(pgrep -f "$CURSOR_BIN" || true)"
  if [ -z "$leftover" ]; then
    break
  fi
  sleep 0.25
done
leftover="$(pgrep -f "$CURSOR_BIN" || true)"
if [ -n "$leftover" ]; then
  echo "cursor still alive after TERM, sending KILL to remaining cursor pids"
  for pid in $leftover; do
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    echo "$cmd" | grep -qi 'war-room' && continue
    kill -KILL "$pid" 2>/dev/null || true
  done
  sleep 1
fi

WR_AFTER_KILL="$(war_room_pids | tr '\n' ' ')"
echo "war_room_pids_after_kill=$WR_AFTER_KILL"
if [ -z "$WR_AFTER_KILL" ] && [ -n "$WR_BEFORE" ]; then
  echo "REFUSING: War Room PIDs disappeared; abort relaunch"
  printf '%s\n' '{"kind":"FOUNDRY_CURSOR_DEDICATED_CDP_ACCEPTANCE_REPORT","CURSOR_CDP_OWNERSHIP":"FAIL","3_Cursor_restart_result":"ABORTED_WAR_ROOM_DIED"}' > "$REPORT"
  exit 2
fi

echo "launching Cursor with loopback debug 127.0.0.1:9333"
setsid "$CURSOR_BIN" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9333 \
  "$REPO" </dev/null >/tmp/foundry-cursor-relaunch.log 2>&1 &
echo "cursor_launch_pid=$!"

ok=0
for _ in $(seq 1 80); do
  if ss -ltn "sport = :9333" 2>/dev/null | grep -q '127.0.0.1:9333'; then
    ok=1
    break
  fi
  sleep 0.5
done
if [ "$ok" != 1 ]; then
  echo "9333 did not come up"
  export FOUNDRY_CURSOR_RESTART_RESULT=FAIL_NO_9333
else
  export FOUNDRY_CURSOR_RESTART_RESULT=PASS
  echo "9333 is listening"
fi

# Give the workbench time to restore the workspace after relaunch.
sleep 15

cd "$REPO"
export FOUNDRY_CURSOR_RESTART_RESULT
node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types \
  lib/native-builder/foundryCursorDedicatedCdp.proof.ts
echo "=== $(date -Is) orchestrator done ==="
