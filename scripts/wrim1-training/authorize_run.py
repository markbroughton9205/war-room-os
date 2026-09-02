#!/usr/bin/env python3
"""Record Commander authorization for WRIM1-RUN-000001 only. Does not start training."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from authorization import issue_ephemeral_authorization_token, load_authorization, record_authorization_event  # noqa: E402
from constants import RUN_ID  # noqa: E402
from paths import repo_root  # noqa: E402
from run_status import persist_authorization, persist_run_fields  # noqa: E402


def main() -> int:
    root = repo_root()
    auth = load_authorization(root)
    if auth.get("run_id") != RUN_ID:
        print("authorization refused: not scoped to WRIM1-RUN-000001", file=sys.stderr)
        return 2
    current = auth.get("authorization_state")
    if current == "AUTHORIZED" and auth.get("TRAINING_AUTHORIZED") is True:
        print(json.dumps({"run_id": RUN_ID, "authorization_state": "AUTHORIZED", "already": True}))
        return 0
    if current != "AWAITING_COMMANDER_AUTHORIZATION":
        print(f"authorization refused: state={current}", file=sys.stderr)
        return 2
    issue_ephemeral_authorization_token(root)
    record_authorization_event(root, from_state=current, to_state="AUTHORIZED")
    persist_authorization(
        root,
        authorization_state="AUTHORIZED",
        training_status="NOT_STARTED",
        TRAINING_READY=True,
        TRAINING_AUTHORIZED=True,
        TRAINING_STARTED=False,
        commander_authorization_token_present=True,
        note="Commander authorized WRIM1-RUN-000001 only. Token value is not recorded.",
    )
    persist_run_fields(
        root,
        authorization_state="AUTHORIZED",
        training_status="NOT_STARTED",
        TRAINING_AUTHORIZED=True,
        TRAINING_STARTED=False,
    )
    print(json.dumps({
        "run_id": RUN_ID,
        "authorization_state": "AUTHORIZED",
        "TRAINING_AUTHORIZED": True,
        "TRAINING_STARTED": False,
        "token_value_recorded": False,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
