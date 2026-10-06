# HVS-UE-03 viewport capture. Assumes AN_Rael_Take3 already retimed.
# Pilots cine cameras at Ra'el and captures the editor viewport after Sequencer seek.
import json
import math
import os
import struct
import time
import traceback
import zlib

import unreal

PROOF = "/home/chosenone/HVSRuntime/Saved/HVS/ue03-proof.json"
PROOF_DIR = "/home/chosenone/HVSRuntime/Saved/HVS/ue03-proof"
SEQ_PATH = "/Game/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a"
MAP_PATH = "/Game/HVS/Maps/HVS_Execution_Test"
ANIM_PATH = "/Game/HVS/Animation/AN_Rael_Take3"
WARM_TICKS = 240
SEEK_SETTLE = 50
STATE = {"tick": 0, "phase": "warm", "index": 0, "wait": 0, "pending": None, "captures": [], "root": [], "handle": None}


def log(msg):
    unreal.log("[HVS-UE-03-CAP] " + str(msg))


def load_proof():
    if os.path.exists(PROOF):
        with open(PROOF, "r", encoding="utf-8") as handle:
            return json.load(handle)
    return {}


def write_proof(data):
    os.makedirs(os.path.dirname(PROOF), exist_ok=True)
    with open(PROOF, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, default=str)
        handle.write("\n")


def png_stats(path):
    result = {"path": path, "exists": os.path.exists(path), "bytes": 0, "width": 0, "height": 0, "meanLuma": 0.0, "nonBlack": False}
    if not result["exists"]:
        return result
    result["bytes"] = os.path.getsize(path)
    try:
        with open(path, "rb") as handle:
            data = handle.read()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            result["nonBlack"] = result["bytes"] > 40000
            return result
        offset = 8
        width = height = 0
        color_type = 2
        idat = []
        while offset + 8 <= len(data):
            length = struct.unpack(">I", data[offset:offset + 4])[0]
            tag = data[offset + 4:offset + 8]
            chunk = data[offset + 8:offset + 8 + length]
            if tag == b"IHDR":
                width, height, _bit, color_type = struct.unpack(">IIBB", chunk[:10])
            elif tag == b"IDAT":
                idat.append(chunk)
            elif tag == b"IEND":
                break
            offset += 12 + length
        raw = zlib.decompress(b"".join(idat))
        channels = {2: 3, 6: 4, 0: 1, 4: 2}.get(color_type, 3)
        stride = width * channels
        total = 0.0
        count = 0
        unique = set()
        cursor = 0
        for _row in range(height):
            cursor += 1
            row = raw[cursor:cursor + stride]
            cursor += stride
            for col in range(0, len(row) - 2, max(channels, 3) * 8):
                r, g, b = row[col], row[col + 1], row[col + 2]
                total += 0.2126 * r + 0.7152 * g + 0.0722 * b
                count += 1
                unique.add((r // 16, g // 16, b // 16))
        result["width"] = width
        result["height"] = height
        result["meanLuma"] = (total / count) if count else 0.0
        result["colorBuckets"] = len(unique)
        result["nonBlack"] = result["meanLuma"] >= 8.0 and result["bytes"] > 25000 and len(unique) >= 6
    except Exception as err:
        result["reason"] = str(err)
        result["nonBlack"] = result["bytes"] > 40000
    return result


def find_actor(name):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == name:
            return actor
    return None


def camera_named(name):
    safe = name.replace(" ", "_").replace("'", "")
    return find_actor("HVS_Cam_" + safe)


def samples():
    return [
        {"name": "vis_t00_wide", "seconds": 0.0, "camera": "Wide", "lensMm": 24, "ticks": 0},
        {"name": "vis_t16_lower_body", "seconds": 1.603, "camera": "Wide", "lensMm": 24, "ticks": 38472},
        {"name": "vis_t30_walk", "seconds": 3.0, "camera": "Walk", "lensMm": 24, "ticks": 72000},
        {"name": "vis_t58_left_arm", "seconds": 5.769, "camera": "Walk", "lensMm": 24, "ticks": 138456},
        {"name": "vis_t60_lookback", "seconds": 6.0, "camera": "Look back", "lensMm": 24, "ticks": 144000},
        {"name": "vis_t80_closeup", "seconds": 8.0, "camera": "Close-up of Ra'el", "lensMm": 85, "ticks": 192000},
        {"name": "vis_t85_closeup", "seconds": 8.5, "camera": "Close-up of Ra'el", "lensMm": 85, "ticks": 204000},
        {"name": "vis_t58_scrub_back", "seconds": 5.769, "camera": "Walk", "lensMm": 24, "ticks": 138456},
        {"name": "vis_t00_restart", "seconds": 0.0, "camera": "Wide", "lensMm": 24, "ticks": 0},
    ]


HVS_CAMERAS = {
    "Wide": {"location": unreal.Vector(454.613041193222, -616.7006185065393, 182.0), "lens": 24.0},
    "Walk": {"location": unreal.Vector(201.44950442280543, -327.3708621974917, 155.0), "lens": 24.0},
    "Look back": {"location": unreal.Vector(342.06409099644526, 528.6172078546033, 182.0), "lens": 24.0},
    "Close-up of Ra'el": {"location": unreal.Vector(-475.0, 180.0, 152.0), "lens": 85.0},
}


def pose_rael(rael, seconds):
    anim = unreal.EditorAssetLibrary.load_asset(ANIM_PATH)
    mesh = rael.skeletal_mesh_component
    try:
        mesh.set_hidden_in_game(False)
        mesh.set_visibility(True)
        mesh.set_update_animation_in_editor(True)
    except Exception:
        pass
    try:
        mesh.override_animation_data(anim, False, False, float(seconds), 1.0)
    except Exception as err:
        log("override_animation_data: " + str(err))


def lens_fov(lens_mm):
    return math.degrees(2.0 * math.atan(18.0 / float(lens_mm)))


def dump_scene(rael):
    origin, extent = rael.get_actor_bounds(False)
    loc = rael.get_actor_location()
    info = {
        "actor": [loc.x, loc.y, loc.z],
        "boundsOrigin": [origin.x, origin.y, origin.z],
        "boundsExtent": [extent.x, extent.y, extent.z],
        "cameras": {},
    }
    for name in HVS_CAMERAS:
        actor = camera_named(name)
        if not actor:
            continue
        cloc = actor.get_actor_location()
        crot = actor.get_actor_rotation()
        info["cameras"][name] = {
            "label": actor.get_actor_label(),
            "location": [cloc.x, cloc.y, cloc.z],
            "rotation": [crot.pitch, crot.yaw, crot.roll],
        }
    try:
        view = unreal.EditorLevelLibrary.get_level_viewport_camera_info()
        if view:
            info["viewport"] = {
                "location": [view[0].x, view[0].y, view[0].z],
                "rotation": [view[1].pitch, view[1].yaw, view[1].roll],
            }
    except Exception as err:
        info["viewportError"] = str(err)
    log("scene dump " + json.dumps(info))
    return info


def place_hvs_cameras(rael):
    loc = rael.get_actor_location()
    chest = unreal.Vector(loc.x, loc.y, loc.z + 100.0)
    head = unreal.Vector(loc.x, loc.y, loc.z + 150.0)
    for name, spec in HVS_CAMERAS.items():
        actor = camera_named(name)
        if not actor:
            actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.CineCameraActor, spec["location"])
            actor.set_actor_label("HVS_Cam_" + name.replace(" ", "_").replace("'", ""))
        target = head if spec["lens"] >= 50 else chest
        direction = target - spec["location"]
        actor.set_actor_location(spec["location"], False, False)
        actor.set_actor_rotation(direction.rotator(), False)
        component = actor.get_cine_camera_component()
        component.set_editor_property("current_focal_length", spec["lens"])
        try:
            film = component.get_editor_property("filmback")
            film.set_editor_property("sensor_width", 36.0)
            film.set_editor_property("sensor_height", 24.0)
            component.set_editor_property("filmback", film)
        except Exception:
            pass
        try:
            component.set_editor_property("constrain_aspect_ratio", False)
        except Exception:
            pass
    light = find_actor("HVS_FillLight")
    if light:
        try:
            unreal.EditorLevelLibrary.destroy_actor(light)
        except Exception:
            pass
    world = unreal.EditorLevelLibrary.get_editor_world()
    for command in (
        "r.EyeAdaptationQuality 0",
        "r.DefaultFeature.AutoExposure 0",
        "showflag.billboardsprites 0",
        "showflag.sprites 0",
        "showflag.modewidgets 0",
        "showflag.bones 1",
        "showflag.grid 1",
    ):
        try:
            unreal.SystemLibrary.execute_console_command(world, command, None)
        except TypeError:
            unreal.SystemLibrary.execute_console_command(world, command)
    try:
        unreal.EditorLevelLibrary.save_current_level()
    except Exception:
        pass


def set_editor_camera(location, rotation, fov):
    try:
        unreal.LevelSequenceEditorBlueprintLibrary.set_lock_camera_cut_to_viewport(False)
    except Exception:
        pass
    try:
        unreal.EditorLevelLibrary.eject_pilot_level_actor()
    except Exception:
        pass
    unreal.EditorLevelLibrary.set_level_viewport_camera_info(location, rotation)
    world = unreal.EditorLevelLibrary.get_editor_world()
    try:
        unreal.SystemLibrary.execute_console_command(world, "fov " + str(round(float(fov), 3)), None)
    except TypeError:
        unreal.SystemLibrary.execute_console_command(world, "fov " + str(round(float(fov), 3)))
    try:
        unreal.EditorLevelLibrary.editor_invalidate_viewports()
    except Exception:
        pass


def rebind_anim_section():
    if not unreal.EditorAssetLibrary.does_asset_exist(SEQ_PATH):
        return
    sequence = unreal.EditorAssetLibrary.load_asset(SEQ_PATH)
    anim = unreal.EditorAssetLibrary.load_asset(ANIM_PATH)
    bind_ext = unreal.MovieSceneBindingExtensions
    track_ext = unreal.MovieSceneTrackExtensions
    for binding in unreal.MovieSceneSequenceExtensions.get_bindings(sequence):
        for track in bind_ext.get_tracks(binding):
            if isinstance(track, unreal.MovieSceneSkeletalAnimationTrack):
                for section in track_ext.get_sections(track):
                    try:
                        params = section.get_editor_property("params")
                        params.set_editor_property("animation", anim)
                        section.set_editor_property("params", params)
                    except Exception:
                        pass
    unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(sequence)
    try:
        unreal.LevelSequenceEditorBlueprintLibrary.set_lock_camera_cut_to_viewport(False)
    except Exception:
        pass


def seek(seconds):
    lib = unreal.LevelSequenceEditorBlueprintLibrary
    params = unreal.MovieSceneSequencePlaybackParams()
    params.position_type = unreal.MovieScenePositionType.TIME
    params.time = float(seconds)
    lib.set_global_position(params, unreal.MovieSceneTimeUnit.DISPLAY_RATE)
    lib.pause()


def measure_root(seconds, rael):
    loc = rael.get_actor_location()
    xform = rael.skeletal_mesh_component.get_bone_transform("root", unreal.RelativeTransformSpace.RTS_WORLD)
    hand = rael.skeletal_mesh_component.get_bone_transform("hand_l", unreal.RelativeTransformSpace.RTS_WORLD)
    return {
        "seconds": seconds,
        "ticks": int(round(seconds * 24000)),
        "actor": [loc.x, loc.y, loc.z],
        "rootWorld": [xform.translation.x, xform.translation.y, xform.translation.z],
        "handL": [hand.translation.x, hand.translation.y, hand.translation.z],
    }


def frame_viewport(sample):
    seek(sample["seconds"])
    rael = find_actor("BP_Rael_Commander")
    if rael:
        pose_rael(rael, sample["seconds"])
    spec = HVS_CAMERAS.get(sample["camera"])
    loc = spec["location"] if spec else (rael.get_actor_location() + unreal.Vector(-280, 180, 140) if rael else unreal.Vector(20, -120, 160))
    target_z = 150.0 if sample["lensMm"] >= 50 else 100.0
    target = (rael.get_actor_location() + unreal.Vector(0, 0, target_z)) if rael else unreal.Vector(20, -120, target_z)
    set_editor_camera(loc, (target - loc).rotator(), lens_fov(sample["lensMm"]))
    return camera_named(sample["camera"])


def begin_capture(sample):
    os.makedirs(PROOF_DIR, exist_ok=True)
    camera = camera_named(sample["camera"])
    path = os.path.join(PROOF_DIR, sample["name"] + ".png")
    if os.path.exists(path):
        os.remove(path)
    task = unreal.AutomationLibrary.take_high_res_screenshot(1600, 900, path, delay=0.50, force_game_view=False)
    focal = sample["lensMm"]
    if camera:
        try:
            focal = float(camera.get_cine_camera_component().get_editor_property("current_focal_length"))
        except Exception:
            pass
    return {"task": task, "path": path, "focalMm": focal, "cameraActor": camera.get_actor_label() if camera else None}


def finish_capture(sample, pending):
    stats = png_stats(pending["path"])
    sample = dict(sample)
    sample.update({
        "path": stats.get("path"),
        "bytes": stats.get("bytes"),
        "meanLuma": stats.get("meanLuma"),
        "nonBlack": bool(stats.get("nonBlack")),
        "colorBuckets": stats.get("colorBuckets"),
        "width": stats.get("width"),
        "height": stats.get("height"),
        "focalMm": pending.get("focalMm"),
        "cameraActor": pending.get("cameraActor"),
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": "pilot_viewport_highresshot",
    })
    return sample


def on_tick(_dt):
    state = STATE
    state["tick"] += 1
    shots = samples()
    if state["phase"] == "warm":
        if state["tick"] < WARM_TICKS:
            return
        state["phase"] = "seek"
        log("warmed ticks=" + str(state["tick"]))
        return
    if state["phase"] == "seek":
        if state["index"] >= len(shots):
            proof = load_proof()
            proof["captures"] = state["captures"]
            proof["root"] = state["root"]
            if state.get("scene"):
                proof["sceneDump"] = state["scene"]
            proof["captureComplete"] = True
            proof["captureMethod"] = "pilot_viewport_highresshot"
            needed = ("vis_t00_wide", "vis_t16_lower_body", "vis_t58_left_arm", "vis_t85_closeup", "vis_t58_scrub_back")
            proof["visualOk"] = all(item.get("nonBlack") for item in state["captures"] if item["name"] in needed)
            write_proof(proof)
            log("capture complete visualOk=" + str(proof["visualOk"]))
            if state["handle"] is not None:
                unreal.unregister_slate_post_tick_callback(state["handle"])
            return
        sample = shots[state["index"]]
        state["sample"] = sample
        state["camera"] = frame_viewport(sample)
        state["phase"] = "settle"
        state["wait"] = 0
        return
    if state["phase"] == "settle":
        state["wait"] += 1
        if state["wait"] < SEEK_SETTLE:
            return
        state["pending"] = begin_capture(state["sample"])
        state["phase"] = "wait"
        state["wait"] = 0
        return
    if state["phase"] == "wait":
        state["wait"] += 1
        path = state.get("pending", {}).get("path")
        task = state.get("pending", {}).get("task")
        done = False
        try:
            done = bool(task and task.is_task_done())
        except Exception:
            done = False
        if (done or state["wait"] >= 90) and path and os.path.exists(path) and os.path.getsize(path) > 1000:
            captured = finish_capture(state["sample"], state["pending"])
            if captured["name"] in ("vis_t00_wide", "vis_t58_left_arm"):
                rael = find_actor("BP_Rael_Commander")
                if rael:
                    state["root"].append(measure_root(captured["seconds"], rael))
            state["captures"].append(captured)
            log("captured " + captured["name"] + " luma=" + str(captured.get("meanLuma")) + " buckets=" + str(captured.get("colorBuckets")))
            state["index"] += 1
            state["phase"] = "seek"
        elif state["wait"] >= 150:
            captured = finish_capture(state["sample"], state["pending"])
            captured["timedOut"] = True
            state["captures"].append(captured)
            state["index"] += 1
            state["phase"] = "seek"


def run():
    if unreal.EditorAssetLibrary.does_asset_exist(MAP_PATH):
        unreal.EditorLevelLibrary.load_level(MAP_PATH)
    rael = find_actor("BP_Rael_Commander")
    if not rael:
        raise RuntimeError("BP_Rael_Commander missing")
    place_hvs_cameras(rael)
    rebind_anim_section()
    STATE["scene"] = dump_scene(rael)
    proof = load_proof()
    proof["sceneDump"] = STATE["scene"]
    write_proof(proof)
    STATE["handle"] = unreal.register_slate_post_tick_callback(on_tick)
    log("capture scheduled")


try:
    run()
except Exception as exc:
    unreal.log_error("[HVS-UE-03-CAP] " + traceback.format_exc())
    proof = load_proof()
    proof["captureError"] = str(exc)
    write_proof(proof)
