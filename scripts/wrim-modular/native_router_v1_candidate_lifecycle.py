#!/usr/bin/env python3
"""Native Router V1 lifecycle metadata (SHADOW <-> CANDIDATE only).

Does not attach ACTIVE modules, does not enable serving, does not touch WRIM
or production. Rollback restores SHADOW metadata and does not delete evidence.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from paths import NATIVE_ROUTER_V1_DIR  # noqa: E402

SHADOW = "SHADOW"
CANDIDATE = "CANDIDATE"
ALLOWED = {(SHADOW, CANDIDATE), (CANDIDATE, SHADOW)}
FORBIDDEN_STATUSES = {"ACTIVE", "PRODUCTION", "SERVING", "PROMOTED_TO_PRODUCTION"}


def _write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=True) + "\n", encoding="utf-8")


def read_manifest() -> dict:
    return json.loads((NATIVE_ROUTER_V1_DIR / "manifest.json").read_text(encoding="utf-8"))


def current_lifecycle() -> str:
    return str(read_manifest().get("lifecycle", ""))


def _apply_lifecycle(new: str) -> dict:
    if new in FORBIDDEN_STATUSES:
        raise ValueError(f"refusing lifecycle {new}")
    man = read_manifest()
    previous = str(man.get("lifecycle", ""))
    if (previous, new) not in ALLOWED and previous != new:
        raise ValueError(f"illegal lifecycle transition {previous} -> {new}")
    man["lifecycle"] = new
    man["serving_activation"] = False
    man["production_activation"] = False
    man["production_serving"] = False
    man["active_modules"] = []
    _write_json(NATIVE_ROUTER_V1_DIR / "manifest.json", man)
    verdict_path = NATIVE_ROUTER_V1_DIR / "readiness-verdict.json"
    verdict = json.loads(verdict_path.read_text(encoding="utf-8"))
    verdict["lifecycle"] = new
    verdict["promoted"] = False
    verdict["serving_activation"] = False
    _write_json(verdict_path, verdict)
    _write_json(
        NATIVE_ROUTER_V1_DIR / "lifecycle.json",
        {
            "active_modules": [],
            "promoted": False,
            "promotion_review": True,
            "serving_activation": False,
            "production_activation": False,
            "status": new,
            "previous_status": previous,
        },
    )
    return {"previous": previous, "new": new, "path": str(NATIVE_ROUTER_V1_DIR / "manifest.json")}


def promote_shadow_to_candidate() -> dict:
    current = current_lifecycle()
    if current != SHADOW:
        raise ValueError(f"expected SHADOW before promotion, found {current}")
    return _apply_lifecycle(CANDIDATE)


def rollback_candidate_to_shadow() -> dict:
    """Restore SHADOW metadata. Does not delete artifacts, WRIM, production, or evidence."""
    current = current_lifecycle()
    if current != CANDIDATE:
        raise ValueError(f"expected CANDIDATE before rollback, found {current}")
    return _apply_lifecycle(SHADOW)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rollback-to-shadow",
        action="store_true",
        help="Restore CANDIDATE -> SHADOW metadata only. Do not delete evidence.",
    )
    parser.add_argument(
        "--promote-shadow-to-candidate",
        action="store_true",
        help="Apply SHADOW -> CANDIDATE metadata only. No serving.",
    )
    args = parser.parse_args()
    if args.rollback_to_shadow:
        print(json.dumps(rollback_candidate_to_shadow(), indent=2))
        return 0
    if args.promote_shadow_to_candidate:
        print(json.dumps(promote_shadow_to_candidate(), indent=2))
        return 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
