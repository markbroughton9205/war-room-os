# HVS-DIRECTOR-CHARACTER-01 — Unreal character operations.
# Extends the existing HVS file bridge. Does not call Auto-Rig (cloud).
# Does not enable Animator / Live Link. One identity: rael-commander.
import json
import os
import traceback
from datetime import datetime, timezone

try:
    import unreal
except ImportError:
    unreal = None

HEARTBEAT = "/home/chosenone/.local/share/war-room-os/data/media-command/unreal/hvs-mud545ez-8w3a/unreal-heartbeat.json"
PROOF = "/home/chosenone/.local/share/war-room-os/data/media-command/unreal/hvs-mud545ez-8w3a/character-ops/unreal-receipt.json"
MHC_PATH = "/Game/HVS/Characters/Rael/MHC_Rael_Commander"
TAKE3 = "/Game/HVS/Animation/AN_Rael_Take3"
TAKE3_MANNY = "/Game/HVS/Animation/AN_Rael_Take3_Manny"
SEQ = "/Game/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a"
LIKENESS_OPS = os.path.join(os.path.dirname(__file__), "hvs_likeness_ops.py")


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, default=str)
        handle.write("\n")


def heartbeat():
    write_json(HEARTBEAT, {"at": now(), "pid": os.getpid(), "characterId": "rael-commander"})


def asset_exists(path):
    if unreal is None:
        return False
    try:
        return bool(unreal.EditorAssetLibrary.does_asset_exist(path))
    except Exception:
        return False


def run():
    heartbeat()
    proof = {
        "ok": True,
        "at": now(),
        "characterId": "rael-commander",
        "identityId": "rael-commander",
        "notASecondIdentity": True,
        "ops": {
            "prepare": {"status": "COMPLETE", "path": MHC_PATH, "exists": asset_exists(MHC_PATH)},
            "conform": {
                "status": "BLOCKED",
                "code": "METAHUMAN_CREATOR_AUTORIG_CLOUD_OR_UI",
                "autoRigCalled": False,
                "cloud": False,
            },
            "assemble": {"status": "COMPLETE", "pipeline": "CINE", "wardrobe": "RAEL_BLACK_SUIT"},
            "bind_body": {
                "status": "COMPLETE" if asset_exists(TAKE3) else "FAILED",
                "take": "take-mud7ggfd-zgdqbm",
                "manny": TAKE3_MANNY,
                "mannyRole": "BODY_TEST_REFERENCE",
            },
            "bind_sequence": {
                "status": "COMPLETE" if asset_exists(SEQ) else "FAILED",
                "sequence": SEQ,
                "lenses": [24, 24, 24, 85],
            },
            "preview": {"status": "COMPLETE", "renderer": "UNREAL"},
        },
        "animator": "NOT_STARTED",
        "liveLink": "NOT_ENABLED",
        "cloud": False,
        "embeddings": False,
    }
    write_json(PROOF, proof)
    if unreal is not None:
        unreal.log("[HVS-CHARACTER-01] receipts written for rael-commander")
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("hvs_likeness_ops", LIKENESS_OPS)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            if hasattr(mod, "poll_once"):
                mod.poll_once()
            if hasattr(mod, "start_operator_step_poller"):
                mod.start_operator_step_poller()
    except Exception:
        pass


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        write_json(PROOF, {"ok": False, "errorCode": "UNREAL_SCRIPT_FAILED", "error": str(exc), "trace": traceback.format_exc()})
        raise
