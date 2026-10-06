# HVS-RAEL-HUMAN-02: create official MHC_Rael_Commander + import local face stills.
# Does not call Auto-Rig (cloud). Does not enable Animator / Live Link.
# Does not assemble a fake Ra'el from the default identity template.
import json
import os
import traceback

import unreal

PROOF = "/home/chosenone/HVSRuntime/Saved/HVS/human02-proof.json"
STILL_DIR = "/home/chosenone/.local/share/war-room-os/data/media-command/face-reference/hvs-mud545ez-8w3a/rael-commander"
SET_JSON = os.path.join(STILL_DIR, "set.json")
MHC_PATH = "/Game/HVS/Characters/Rael/MHC_Rael_Commander"
MHC_DIR = "/Game/HVS/Characters/Rael"
TEX_DIR = "/Game/HVS/Characters/Rael/FaceReference"
REQUIRED = [
    "FRONT_NEUTRAL",
    "LEFT_THREE_QUARTER",
    "RIGHT_THREE_QUARTER",
    "LEFT_PROFILE",
    "RIGHT_PROFILE",
]
OPTIONAL = ["FRONT_SMILE"]


def log(msg):
    unreal.log("[HVS-HUMAN-02] " + str(msg))


def write_proof(data):
    os.makedirs(os.path.dirname(PROOF), exist_ok=True)
    with open(PROOF, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, default=str)
        handle.write("\n")


def resolve_class(*names):
    for name in names:
        cls = getattr(unreal, name, None)
        if cls is not None:
            return name, cls
        try:
            loaded = unreal.load_class(None, name)
        except Exception:
            loaded = None
        if loaded is not None:
            return name, loaded
    return None, None


def import_still(slot, src):
    if not os.path.isfile(src):
        return {"type": slot, "ok": False, "error": "missing_file", "file": src, "texturePath": None}
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    task = unreal.AssetImportTask()
    task.filename = src
    task.destination_path = TEX_DIR
    task.destination_name = slot
    task.replace_existing = True
    task.automated = True
    task.save = True
    factory = unreal.TextureFactory()
    try:
        factory.set_editor_property("create_material", False)
    except Exception:
        pass
    task.factory = factory
    tools.import_asset_tasks([task])
    texture_path = TEX_DIR + "/" + slot
    asset = unreal.EditorAssetLibrary.load_asset(texture_path)
    return {
        "type": slot,
        "ok": asset is not None,
        "file": src,
        "bytes": os.path.getsize(src),
        "texturePath": texture_path if asset is not None else None,
        "importedClass": str(type(asset)) if asset is not None else None,
    }


def create_mhc():
    existing = unreal.EditorAssetLibrary.does_asset_exist(MHC_PATH)
    factory_name, factory_cls = resolve_class(
        "MetaHumanCharacterFactoryNew",
        "/Script/MetaHumanCharacterEditor.MetaHumanCharacterFactoryNew",
    )
    char_name, char_cls = resolve_class(
        "MetaHumanCharacter",
        "/Script/MetaHumanCharacter.MetaHumanCharacter",
    )
    result = {
        "existed": bool(existing),
        "factoryName": factory_name,
        "characterClassName": char_name,
        "created": False,
        "path": MHC_PATH,
        "error": None,
        "valid": None,
        "pipelineType": None,
        "pythonMetaHumanAttrs": [name for name in dir(unreal) if "metahuman" in name.lower() or "MetaHuman" in name][:80],
    }
    if existing:
        result["created"] = True
        result["note"] = "Asset already existed. Not overwritten."
        return result
    if factory_cls is None or char_cls is None:
        result["error"] = "MetaHumanCharacter factory/class is not exposed to Unreal Python on this editor."
        return result
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = factory_cls()
    asset = tools.create_asset("MHC_Rael_Commander", MHC_DIR, char_cls, factory)
    if asset is None:
        result["error"] = "AssetTools.create_asset returned None."
        return result
    try:
        settings = asset.get_editor_property("assembly_settings")
        settings.set_editor_property("pipeline_type", unreal.MetaHumanDefaultPipelineType.CINEMATIC)
        settings.set_editor_property("name_override", "MHC_Rael_Commander")
        root = unreal.DirectoryPath()
        root.path = MHC_DIR
        settings.set_editor_property("root_directory", root)
        asset.set_editor_property("assembly_settings", settings)
        result["pipelineType"] = str(settings.get_editor_property("pipeline_type"))
    except Exception as exc:
        result["pipelineError"] = str(exc)
    try:
        unreal.EditorAssetLibrary.save_asset(MHC_PATH)
    except Exception as exc:
        result["saveError"] = str(exc)
    result["created"] = True
    try:
        result["valid"] = bool(asset.is_character_valid())
    except Exception:
        result["valid"] = None
    return result


def main():
    proof = {
        "ok": False,
        "slice": "HVS-RAEL-HUMAN-02",
        "characterId": "rael-commander",
        "identityId": "rael-commander",
        "projectId": "hvs-mud545ez-8w3a",
        "takeId": "take-mud7ggfd-zgdqbm",
        "motionId": "motion-mud7ggel-h3xmyo",
        "autoRigCalled": False,
        "animatorEnabled": False,
        "liveLinkEnabled": False,
        "cloud": False,
        "likenessConformed": False,
        "stills": [],
        "mhc": None,
        "errors": [],
    }
    try:
        with open(SET_JSON, "r", encoding="utf-8") as handle:
            face = json.load(handle)
        stills = face.get("stills") or {}
        missing = [slot for slot in REQUIRED if not stills.get(slot, {}).get("accepted")]
        if missing:
            raise RuntimeError("Required stills not accepted: " + ",".join(missing))
        unreal.EditorAssetLibrary.make_directory(MHC_DIR)
        unreal.EditorAssetLibrary.make_directory(TEX_DIR)
        imported = []
        for slot in REQUIRED + OPTIONAL:
            item = stills.get(slot)
            if not item:
                continue
            imported.append(import_still(slot, item["file"]))
        proof["stills"] = imported
        proof["mhc"] = create_mhc()
        proof["ok"] = all(item.get("ok") for item in imported if item["type"] in REQUIRED) and bool(proof["mhc"] and proof["mhc"].get("created"))
        if proof["mhc"] and proof["mhc"].get("error"):
            proof["errors"].append(proof["mhc"]["error"])
            proof["ok"] = False
            proof["gate"] = {
                "status": "BLOCKED",
                "code": "METAHUMAN_PYTHON_FACTORY_UNAVAILABLE" if "not exposed" in str(proof["mhc"].get("error")) else "MHC_CREATE_FAILED",
                "message": proof["mhc"]["error"],
            }
        else:
            proof["gate"] = {
                "status": "BLOCKED",
                "code": "METAHUMAN_CREATOR_AUTORIG_CLOUD_OR_UI",
                "cloudRequired": True,
                "animatorRequired": False,
                "message": "MHC asset/stills advanced locally. Official photo-to-likeness auto-rig calls Epic AutoRigService (cloud). Animator Identity Solve is not authorized. Likeness remains NOT_FINAL.",
            }
    except Exception as exc:
        proof["errors"].append(str(exc))
        proof["traceback"] = traceback.format_exc()
        proof["ok"] = False
    write_proof(proof)
    log(json.dumps({k: proof.get(k) for k in ("ok", "errors", "gate", "mhc")}, default=str))
    try:
        unreal.SystemLibrary.execute_console_command(None, "QUIT_EDITOR")
    except Exception as exc:
        log("quit skipped: " + str(exc))


if __name__ == "__main__":
    main()
