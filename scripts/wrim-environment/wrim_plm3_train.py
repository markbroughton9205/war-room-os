"""WRIM1-PLM-000003 trainer stub. TRAINING IS NOT AUTHORIZED.

This file exists so the proposed run identity is fail-closed.
It never constructs AdamW and never calls optimizer.step.
Use wrim_plm3_probe.py for the authorized backward-only diagnostic.
"""
from __future__ import annotations

import json
import os
import sys

from wrim_plm3_identity import AUTHORIZE_ENV_NAME, RUN_ID


def main() -> dict:
    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    payload = {
        "ok": False,
        "kind": "WRIM1_PLM_000003_TRAINING_DENIED",
        "RUN_ID": RUN_ID,
        "reason": "PREPARATION_ONLY_NO_TRAINING_AUTHORIZATION",
        "TRAINING_AUTHORIZATION": "OFF",
        "optimizer_steps": 0,
        "AdamW_constructed": False,
        "training_executed": False,
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "CPT_000006_CREATED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "note": "Commander must issue a separate WRIM1-PLM-000003 training authorization after a SAFE gradient probe.",
    }
    print(json.dumps(payload, indent=2))
    return payload


if __name__ == "__main__":
    main()
    sys.exit(2)
