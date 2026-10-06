# HVS-DIRECTOR-CHARACTER-02 — official MetaHuman likeness operations.
# Cloud AutoRig / texture synthesis run ONLY when an HVS authority file exists
# AND the request payload sets executeCloud true.
# Original JPEG stills are never uploaded. Payload is the official derived Face Mesh.
import json
import os
import traceback
from datetime import datetime, timezone

try:
    import unreal
except ImportError:
    unreal = None

PROJECT_ID = "hvs-mud545ez-8w3a"
CHARACTER_ID = "rael-commander"
DATA = f"/home/chosenone/.local/share/war-room-os/data/media-command/unreal/{PROJECT_ID}"
OPS = os.path.join(DATA, "character-ops")
AUTHORITY = os.path.join(DATA, "character-production", f"{CHARACTER_ID}.authority.json")
REQUEST = os.path.join(OPS, "hvs_unreal_character_conform.request.json")
PREVIEW_REQUEST = os.path.join(OPS, "hvs_unreal_character_preview.request.json")
PROOF = os.path.join(OPS, "likeness-receipt.json")
PREVIEW_DIR = f"/home/chosenone/.local/share/war-room-os/data/media-command/character-production/{PROJECT_ID}/{CHARACTER_ID}/preview"
MHC_PATH = "/Game/HVS/Characters/Rael/MHC_Rael_Commander"
TAKE3 = "/Game/HVS/Animation/AN_Rael_Take3"
SEQ = "/Game/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a"


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, default=str)
        handle.write("\n")


def read_json(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def authority_ok():
    data = read_json(AUTHORITY)
    if not data:
        return False
    return (
        data.get("authorityType") == "METAHUMAN_LIKENESS_CLOUD"
        and data.get("provider") == "EPIC_METAHUMAN"
        and data.get("scope") == "LIKELINESS_CONFORM_AUTORIG_ONLY"
        and data.get("trainingAllowed") is False
        and data.get("voiceAllowed") is False
        and data.get("faceRecognitionAllowed") is False
        and data.get("spendAllowed") is False
    )


def asset_exists(path):
    if unreal is None:
        return False
    try:
        return bool(unreal.EditorAssetLibrary.does_asset_exist(path))
    except Exception:
        return False


def subsystem():
    if unreal is None:
        return None
    return unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)


def open_mhc():
    if unreal is None:
        return {"ok": False, "errorCode": "UNREAL_NOT_AVAILABLE"}
    character = unreal.load_asset(MHC_PATH)
    if character is None:
        return {"ok": False, "errorCode": "MHC_NOT_CREATED", "path": MHC_PATH}
    opened = False
    api = "AssetEditorSubsystem.open_editor_for_assets"
    editors = unreal.get_editor_subsystem(unreal.AssetEditorSubsystem)
    if editors:
        opened_method = unreal.AssetTypeActivationOpenedMethod.EDIT
        opened = bool(editors.open_editor_for_assets([character], opened_method))
    if unreal is not None:
        unreal.log("[HVS] open_mhc %s opened=%s" % (MHC_PATH, opened))
    return {
        "ok": bool(opened),
        "action": "open_mhc",
        "path": MHC_PATH,
        "assetEditorApi": api,
        "assetEditorOpenRequested": True,
        "assetEditorOpened": bool(opened),
        "autoRigCalled": False,
        "cloud": False,
        "executeCloud": False,
        "networkSideEffect": False,
    }


def consume_operator_step():
    request = read_json(REQUEST) or {}
    action = request.get("action")
    if action not in ("open_mhc", "epic_signin"):
        return None
    if request.get("executeCloud") is True:
        return None
    token = str(request.get("requestedAt") or "")
    if request.get("_hvsConsumedAt") and request.get("_hvsConsumedToken") == token and token:
        return None
    result = open_mhc()
    if action == "epic_signin":
        result["epicSignInRequired"] = True
        result["headline"] = "EPIC SIGN-IN REQUIRED"
    request["_hvsConsumedAt"] = now()
    request["_hvsConsumedToken"] = token
    request["_hvsConsumedAction"] = action
    write_json(REQUEST, request)
    write_json(PROOF, {
        **result,
        "at": now(),
        "requestedAt": token,
        "autoRigCalled": False,
        "networkSideEffect": False,
        "cloud": False,
        "executeCloud": False,
        "quitEditor": False,
    })
    return result


_operator_poller = {"handle": None, "lastHeartbeat": 0.0, "frames": 0, "readyFrames": 90}


def _poller_heartbeat():
    import time
    now_s = time.time()
    if now_s - _operator_poller["lastHeartbeat"] < 2.0:
        return
    _operator_poller["lastHeartbeat"] = now_s
    write_json(os.path.join(DATA, "unreal-heartbeat.json"), {
        "at": now(),
        "pid": os.getpid(),
        "characterId": CHARACTER_ID,
        "poller": True,
        "quitEditor": False,
        "frames": _operator_poller["frames"],
    })


def start_operator_step_poller():
    if unreal is None or _operator_poller["handle"] is not None:
        return False
    def on_tick(_dt):
        _operator_poller["frames"] += 1
        _poller_heartbeat()
        # Wait until the interactive editor has actually begun ticking
        # before opening MHC. Opening during Python startup contends with
        # Vulkan init and can OOM the MHC viewport.
        if _operator_poller["frames"] < _operator_poller["readyFrames"]:
            return
        consume_operator_step()
    _operator_poller["handle"] = unreal.register_slate_post_tick_callback(on_tick)
    if unreal is not None:
        unreal.log("[HVS] operator-step poller started (editor stays open)")
    return True


def capture_preview(preview_path=None):
    path = preview_path or os.path.join(PREVIEW_DIR, "rael-unreal-preview.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if unreal is None:
        return {"ok": False, "errorCode": "UNREAL_NOT_AVAILABLE", "path": path}
    if os.path.exists(path):
        os.remove(path)
    unreal.AutomationLibrary.take_high_res_screenshot(1600, 900, path, delay=0.50, force_game_view=False)
    exists = os.path.exists(path)
    return {
        "ok": exists,
        "path": path,
        "width": 1600 if exists else 0,
        "height": 900 if exists else 0,
        "renderEngine": "UNREAL",
        "camera": "Close-up",
        "lensMm": 85,
        "autoRigCalled": False,
    }


def zero_cloud_receipt(reason):
    return {
        "ok": True,
        "at": now(),
        "characterId": CHARACTER_ID,
        "autoRigCalled": False,
        "textureSynthesisCalled": False,
        "networkSideEffect": False,
        "cloud": False,
        "payloadCategory": None,
        "reason": reason,
        "animator": "NOT_STARTED",
        "liveLink": "NOT_ENABLED",
        "dnaPresent": False,
        "identityFitted": False,
    }


def run_official_likeness(request):
    if not authority_ok():
        receipt = zero_cloud_receipt("NO_AUTHORITY")
        receipt["errorCode"] = "LIKELINESS_APPROVAL_REQUIRED"
        write_json(PROOF, receipt)
        return receipt
    if not request.get("executeCloud"):
        receipt = zero_cloud_receipt("EXECUTE_CLOUD_FALSE")
        write_json(PROOF, receipt)
        return receipt
    if unreal is None:
        receipt = zero_cloud_receipt("UNREAL_NOT_AVAILABLE")
        receipt["ok"] = False
        write_json(PROOF, receipt)
        return receipt

    meta = subsystem()
    character = unreal.load_asset(MHC_PATH)
    if character is None or meta is None:
        receipt = {
            "ok": False,
            "errorCode": "MHC_NOT_CREATED",
            "autoRigCalled": False,
            "textureSynthesisCalled": False,
            "networkSideEffect": False,
            "dnaPresent": False,
        }
        write_json(PROOF, receipt)
        return receipt

    added = meta.try_add_object_to_edit(character)
    if not added:
        receipt = {
            "ok": False,
            "errorCode": "MHC_ALREADY_EDITING_OR_UNAVAILABLE",
            "autoRigCalled": False,
            "textureSynthesisCalled": False,
            "operatorStep": "OPEN_REQUIRED_STEP",
            "dnaPresent": False,
        }
        write_json(PROOF, receipt)
        return receipt

    auto_rig_called = False
    texture_called = False
    dna_present = False
    cine_assembled = False
    error_code = None
    assembled_path = None
    try:
        auto_params = unreal.MetaHumanCharacterAutoRiggingRequestParams()
        auto_params.blocking = True
        auto_params.report_progress = False
        auto_params.rig_type = unreal.MetaHumanRigType.JOINTS_AND_BLENDSHAPES
        meta.request_auto_rigging(character, auto_params)
        auto_rig_called = True

        # Official CINE assembly requires high-resolution textures (CanBuildMetaHuman).
        texture_params = unreal.MetaHumanCharacterTextureRequestParams()
        texture_params.blocking = True
        texture_params.report_progress = False
        meta.request_texture_sources(character, texture_params)
        texture_called = True

        can_build = meta.can_build_meta_human(character, True)
        dna_present = bool(can_build)
        if can_build:
            build_params = unreal.MetaHumanCharacterEditorBuildParameters()
            build_params.pipeline_type = unreal.MetaHumanDefaultPipelineType.CINEMATIC
            build_params.pipeline_quality = unreal.MetaHumanQualityLevel.CINEMATIC
            build_params.enable_wardrobe_item_validation = False
            meta.build_meta_human(character=character, params=build_params)
            cine_assembled = True
            assembled_path = "/Game/MetaHumans"
        else:
            error_code = "CHARACTER_NOT_READY_FOR_CINE"
    except Exception as exc:
        message = str(exc)
        error_code = "Unauthorized" if "unauthor" in message.lower() else "AUTORIG_FAILED"
        if error_code == "Unauthorized":
            receipt = {
                "ok": False,
                "errorCode": "Unauthorized",
                "epicSignInRequired": True,
                "autoRigCalled": auto_rig_called,
                "textureSynthesisCalled": texture_called,
                "networkSideEffect": auto_rig_called,
                "dnaPresent": False,
            }
            write_json(PROOF, receipt)
            return receipt
        raise
    finally:
        if meta.is_object_added_for_editing(character):
            meta.remove_object_to_edit(character)

    receipt = {
        "ok": dna_present,
        "at": now(),
        "characterId": CHARACTER_ID,
        "autoRigCalled": auto_rig_called,
        "textureSynthesisCalled": texture_called,
        "networkSideEffect": auto_rig_called,
        "payloadCategory": "DERIVED_FACE_MESH_VERTICES",
        "provider": "EPIC_METAHUMAN",
        "mhc": MHC_PATH,
        "dnaPresent": dna_present,
        "dnaAssetPath": None,
        "dnaInternal": True,
        "rigLogic": "RIGGED" if dna_present else "UNRIGGED",
        "faceMeshPath": None,
        "bodyMeshPath": None,
        "identityFitted": True,
        "cineAssembled": cine_assembled,
        "assembledBlueprintPath": assembled_path,
        "pipeline": "CINE",
        "wardrobe": "RAEL_BLACK_SUIT",
        "body": "NEUTRAL",
        "groom": "NEUTRAL",
        "animator": "NOT_STARTED",
        "liveLink": "NOT_ENABLED",
        "errorCode": error_code,
        "take3": TAKE3,
        "sequence": SEQ,
    }
    write_json(PROOF, receipt)
    preview = capture_preview(os.path.join(PREVIEW_DIR, "rael-unreal-preview.png"))
    receipt["preview"] = preview
    write_json(PROOF, receipt)
    return receipt


def poll_once():
    request = read_json(REQUEST) or {}
    action = request.get("action")
    if action == "open_mhc" or action == "epic_signin":
        result = consume_operator_step()
        start_operator_step_poller()
        return result
    preview_req = read_json(PREVIEW_REQUEST)
    if preview_req and not request.get("executeCloud"):
        path = preview_req.get("previewPath") or os.path.join(PREVIEW_DIR, "rael-unreal-preview.png")
        result = capture_preview(path)
        write_json(PROOF, {**result, "at": now(), "action": "preview"})
        start_operator_step_poller()
        return result
    if request.get("executeCloud"):
        return run_official_likeness(request)
    receipt = zero_cloud_receipt("NO_EXECUTE_CLOUD")
    write_json(PROOF, receipt)
    start_operator_step_poller()
    return receipt


if __name__ == "__main__":
    try:
        # Persistent editor path: register the file-bridge poller only.
        # MHC open happens on a later tick so it does not define editor lifetime
        # and does not race Vulkan startup.
        start_operator_step_poller()
    except Exception as exc:
        write_json(PROOF, {
            "ok": False,
            "errorCode": "UNREAL_SCRIPT_FAILED",
            "error": str(exc),
            "trace": traceback.format_exc(),
            "autoRigCalled": False,
            "quitEditor": False,
        })
        raise
