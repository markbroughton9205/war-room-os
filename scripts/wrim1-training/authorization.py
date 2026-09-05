from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

from constants import AUTH_STATES, RUN_ID
from paths import official_ckpt_dir, wave9_dir

ALLOWED_START_STATES = {"AUTHORIZED"}
ALLOWED_RESUME_STATES = {"AUTHORIZED", "TRAINING"}


def token_path(root: Path) -> Path:
    return wave9_dir(root) / "commander-authorization.token"


def default_authorization() -> dict:
    return {
        "run_id": RUN_ID,
        "authorization_state": "AWAITING_COMMANDER_AUTHORIZATION",
        "training_status": "NOT_STARTED",
        "TRAINING_READY": True,
        "TRAINING_AUTHORIZED": False,
        "TRAINING_STARTED": False,
        "commander_authorization_token_present": False,
        "note": "Wave 9 implementation does not constitute Commander training authorization.",
    }


def load_authorization(root: Path) -> dict:
    path = wave9_dir(root) / "authorization.json"
    if not path.is_file():
        return {**default_authorization(), "authorization_state": "NOT_READY", "TRAINING_READY": False}
    return json.loads(path.read_text(encoding="utf-8"))


def _assert_token(root: Path, claimed_token: str | None) -> None:
    path = token_path(root)
    if not path.is_file():
        raise PermissionError("official WRIM-1 start blocked: commander authorization token file missing")
    expected = path.read_text(encoding="utf-8").strip()
    claimed = (claimed_token or os.environ.get("WRIM1_COMMANDER_AUTHORIZATION_TOKEN") or "").strip()
    if not expected or not claimed or claimed != expected:
        raise PermissionError("official WRIM-1 start blocked: authorization token mismatch")


def assert_official_start_allowed(root: Path, claimed_token: str | None) -> None:
    auth = load_authorization(root)
    if auth.get("run_id") != RUN_ID:
        raise PermissionError("official WRIM-1 start blocked: authorization is not for WRIM1-RUN-000001")
    if auth.get("authorization_state") not in ALLOWED_START_STATES:
        raise PermissionError(
            f"official WRIM-1 start blocked: authorization_state={auth.get('authorization_state')} "
            f"(required AUTHORIZED)"
        )
    if auth.get("TRAINING_AUTHORIZED") is not True:
        raise PermissionError("official WRIM-1 start blocked: TRAINING_AUTHORIZED is not true")
    if auth.get("TRAINING_STARTED") is True:
        raise PermissionError("official WRIM-1 start blocked: a run is already marked started")
    _assert_token(root, claimed_token)
    ckpt = official_ckpt_dir(root)
    if ckpt.exists():
        names = list(ckpt.rglob("model.safetensors"))
        if names:
            raise PermissionError("official WRIM-1 start blocked: existing official checkpoint present")


def assert_official_resume_allowed(root: Path, claimed_token: str | None) -> None:
    auth = load_authorization(root)
    if auth.get("run_id") != RUN_ID:
        raise PermissionError("official WRIM-1 resume blocked: authorization is not for WRIM1-RUN-000001")
    if auth.get("authorization_state") not in ALLOWED_RESUME_STATES:
        raise PermissionError(
            f"official WRIM-1 resume blocked: authorization_state={auth.get('authorization_state')}"
        )
    if auth.get("TRAINING_AUTHORIZED") is not True:
        raise PermissionError("official WRIM-1 resume blocked: TRAINING_AUTHORIZED is not true")
    _assert_token(root, claimed_token)


def issue_ephemeral_authorization_token(root: Path) -> None:
    path = token_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_text(encoding="utf-8").strip():
        return
    path.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    os.chmod(path, 0o600)


def record_authorization_event(root: Path, *, from_state: str, to_state: str) -> dict:
    if to_state not in AUTH_STATES:
        raise ValueError(f"invalid authorization state {to_state}")
    event = {
        "run_id": RUN_ID,
        "from": from_state,
        "to": to_state,
        "at": datetime.now(timezone.utc).isoformat(),
        "scope": "WRIM1-RUN-000001 only",
        "token_value_recorded": False,
        "commander_authorization_token_present": token_path(root).is_file(),
        "note": "Commander authorized WRIM1-RUN-000001. Token value is not recorded.",
    }
    path = wave9_dir(root) / "authorization-event.json"
    events_path = wave9_dir(root) / "authorization-events.jsonl"
    from checkpoint_io import atomic_write_json
    atomic_write_json(path, event)
    with open(events_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True) + "\n")
    return event


def official_start_would_be_blocked(root: Path) -> dict:
    try:
        assert_official_start_allowed(root, None)
        return {"blocked": False, "error": None}
    except PermissionError as exc:
        created = official_ckpt_dir(root).exists()
        return {"blocked": True, "error": str(exc), "official_checkpoint_dir_exists": created}
