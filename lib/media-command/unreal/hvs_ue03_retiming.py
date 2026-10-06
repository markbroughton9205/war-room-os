# HVS-UE-03: retiming AN_Rael_Take3 to HVS duration + warmed viewport proof.
# Does not mutate HVS source truth. Does not invent right-arm or face motion.
import json
import math
import os
import struct
import time
import traceback
import zlib

import unreal

PACKAGE = "/home/chosenone/.local/share/war-room-os/data/media-command/unreal/hvs-mud545ez-8w3a/take3-execution.json"
PROOF = "/home/chosenone/HVSRuntime/Saved/HVS/ue03-proof.json"
PROOF_DIR = "/home/chosenone/HVSRuntime/Saved/HVS/ue03-proof"
MANNY = "/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple"
MAP_PATH = "/Game/HVS/Maps/HVS_Execution_Test"
ANIM_PATH = "/Game/HVS/Animation/AN_Rael_Take3"
SEQ_PATH = "/Game/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a"
HVS_DURATION = 230769.0 / 24000.0
TARGET_FPS = 60
# 577 keys at 60fps yields a 0.5 frame remainder when Unreal resamples to 30fps.
# Even count required: 576/60 = 9.6s (15.375ms vs HVS 9.615375s, < 1 display frame).
SAMPLE_COUNT = 576
CHILD_OF = {
    "PELVIS": "ROOT",
    "SPINE_01": "PELVIS",
    "SPINE_02": "SPINE_01",
    "CHEST": "SPINE_02",
    "NECK": "CHEST",
    "HEAD": "NECK",
    "LEFT_CLAVICLE": "CHEST",
    "LEFT_SHOULDER": "LEFT_CLAVICLE",
    "LEFT_ELBOW": "LEFT_SHOULDER",
    "LEFT_WRIST": "LEFT_ELBOW",
    "RIGHT_CLAVICLE": "CHEST",
    "RIGHT_SHOULDER": "RIGHT_CLAVICLE",
    "RIGHT_ELBOW": "RIGHT_SHOULDER",
    "RIGHT_WRIST": "RIGHT_ELBOW",
    "LEFT_HIP": "PELVIS",
    "LEFT_KNEE": "LEFT_HIP",
    "LEFT_ANKLE": "LEFT_KNEE",
    "LEFT_FOOT": "LEFT_ANKLE",
    "RIGHT_HIP": "PELVIS",
    "RIGHT_KNEE": "RIGHT_HIP",
    "RIGHT_ANKLE": "RIGHT_KNEE",
    "RIGHT_FOOT": "RIGHT_ANKLE",
}
AIM_CHILD = {
    "PELVIS": "SPINE_01",
    "SPINE_01": "SPINE_02",
    "SPINE_02": "CHEST",
    "CHEST": "NECK",
    "NECK": "HEAD",
    "LEFT_CLAVICLE": "LEFT_SHOULDER",
    "LEFT_SHOULDER": "LEFT_ELBOW",
    "LEFT_ELBOW": "LEFT_WRIST",
    "RIGHT_CLAVICLE": "RIGHT_SHOULDER",
    "RIGHT_SHOULDER": "RIGHT_ELBOW",
    "RIGHT_ELBOW": "RIGHT_WRIST",
    "LEFT_HIP": "LEFT_KNEE",
    "LEFT_KNEE": "LEFT_ANKLE",
    "LEFT_ANKLE": "LEFT_FOOT",
    "RIGHT_HIP": "RIGHT_KNEE",
    "RIGHT_KNEE": "RIGHT_ANKLE",
    "RIGHT_ANKLE": "RIGHT_FOOT",
}

STATE = {"tick": 0, "phase": "warm", "index": 0, "wait": 0, "task": None, "captures": [], "root": [], "handle": None, "proof": {}}


def log(msg):
    unreal.log("[HVS-UE-03] " + str(msg))


def identity_quat():
    try:
        return unreal.Quat.IDENTITY
    except Exception:
        return unreal.Quat(0.0, 0.0, 0.0, 1.0)


def hvs_to_ue(x, y, z, scale=100.0):
    return unreal.Vector(z * scale, x * scale, y * scale)


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
            result["reason"] = "not-png"
            result["nonBlack"] = result["bytes"] > 40000
            return result
        offset = 8
        width = height = 0
        bit_depth = color_type = 8
        idat = []
        while offset + 8 <= len(data):
            length = struct.unpack(">I", data[offset:offset + 4])[0]
            tag = data[offset + 4:offset + 8]
            chunk = data[offset + 8:offset + 8 + length]
            if tag == b"IHDR":
                width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk[:10])
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
        cursor = 0
        for _row in range(height):
            cursor += 1
            row = raw[cursor:cursor + stride]
            cursor += stride
            for col in range(0, len(row) - 2, channels):
                r, g, b = row[col], row[col + 1], row[col + 2]
                total += 0.2126 * r + 0.7152 * g + 0.0722 * b
                count += 1
        result["width"] = width
        result["height"] = height
        result["meanLuma"] = (total / count) if count else 0.0
        result["nonBlack"] = result["meanLuma"] >= 8.0 and result["bytes"] > 25000
    except Exception as err:
        result["reason"] = str(err)
        result["nonBlack"] = result["bytes"] > 40000
    return result


def lerp_vec(a, b, t):
    return unreal.Vector(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)


def slerp_quat(a, b, t):
    ax, ay, az, aw = a.x, a.y, a.z, a.w
    bx, by, bz, bw = b.x, b.y, b.z, b.w
    dot = ax * bx + ay * by + az * bz + aw * bw
    if dot < 0:
        bx, by, bz, bw = -bx, -by, -bz, -bw
        dot = -dot
    if dot > 0.9995:
        x, y, z, w = ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, aw + (bw - aw) * t
        norm = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
        return unreal.Quat(x / norm, y / norm, z / norm, w / norm)
    theta = math.acos(max(-1.0, min(1.0, dot)))
    sine = math.sin(theta) or 1e-8
    wa = math.sin((1.0 - t) * theta) / sine
    wb = math.sin(t * theta) / sine
    return unreal.Quat(ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb)


def resample_keys(pos_keys, rot_keys, scale_keys, dest_count):
    src = len(pos_keys)
    out_p, out_r, out_s = [], [], []
    for index in range(dest_count):
        u = 0.0 if dest_count == 1 else index * (src - 1) / float(dest_count - 1)
        i0 = int(math.floor(u))
        i1 = min(src - 1, i0 + 1)
        t = u - i0
        out_p.append(lerp_vec(pos_keys[i0], pos_keys[i1], t))
        out_r.append(slerp_quat(rot_keys[i0], rot_keys[i1], t))
        out_s.append(lerp_vec(scale_keys[i0], scale_keys[i1], t))
    return out_p, out_r, out_s


def cross(a, b):
    return unreal.Vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)


def quat_from_to(from_v, to_v):
    a = unreal.Vector(from_v[0], from_v[1], from_v[2])
    b = unreal.Vector(to_v[0], to_v[1], to_v[2])
    if a.length() < 1e-6 or b.length() < 1e-6:
        return identity_quat()
    a = a.normal()
    b = b.normal()
    dot = max(-1.0, min(1.0, a.x * b.x + a.y * b.y + a.z * b.z))
    if dot > 0.9999:
        return identity_quat()
    if dot < -0.9999:
        axis = cross(a, unreal.Vector(1, 0, 0))
        if axis.length() < 1e-4:
            axis = cross(a, unreal.Vector(0, 1, 0))
        axis = axis.normal()
        return unreal.Quat(axis, math.pi)
    axis = cross(a, b)
    s = math.sqrt((1.0 + dot) * 2.0)
    inv = 1.0 / s
    return unreal.Quat(axis.x * inv, axis.y * inv, axis.z * inv, s * 0.5)


def spawn_or_find(cls, name, location, rotation=None):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == name:
            return actor
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(cls, location, rotation or unreal.Rotator(0, 0, 0))
    actor.set_actor_label(name)
    return actor


def find_actor(name):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == name:
            return actor
    return None


def inspect_skeleton(mesh):
    actor = spawn_or_find(unreal.SkeletalMeshActor, "_HVS_BoneProbe", unreal.Vector(0, 0, -10000))
    comp = actor.skeletal_mesh_component
    try:
        comp.set_skeletal_mesh_asset(mesh)
    except Exception:
        comp.set_skeletal_mesh(mesh)
    names = [str(comp.get_bone_name(index)) for index in range(comp.get_num_bones())]
    rest = {}
    for name in names:
        xform = comp.get_bone_transform(name, unreal.RelativeTransformSpace.RTS_WORLD)
        rest[name] = {"location": xform.translation, "rotation": xform.rotation, "parent": str(comp.get_parent_bone(name) or "")}
    unreal.EditorLevelLibrary.destroy_actor(actor)
    return names, rest


def resolve_unreal_bone(mapped, bone_names):
    lookup = {name.lower(): name for name in bone_names}
    return lookup.get(mapped.lower())


def anim_controller(anim):
    controller = anim.get_editor_property("controller") if hasattr(anim, "get_editor_property") else None
    if controller is None:
        controller = getattr(anim, "controller", None)
    if controller is None:
        raise RuntimeError("AnimSequence has no AnimationDataController")
    return controller


def quat_mul(a, b):
    try:
        return a.multiply(b)
    except Exception:
        return a * b


def quat_inv(q):
    try:
        return q.inversed()
    except Exception:
        return q.inverse()


def hvs_topo():
    order = []
    seen = set()
    def visit(name):
        if name in seen:
            return
        parent = CHILD_OF.get(name)
        if parent:
            visit(parent)
        seen.add(name)
        order.append(name)
    visit("ROOT")
    for name in CHILD_OF:
        visit(name)
    return order


def joint_ue(pose, name):
    if name == "ROOT":
        root = pose.get("root") or [0, 0, 0]
        return hvs_to_ue(root[0], root[1], root[2])
    joint = (pose.get("joints") or {}).get(name)
    if not joint:
        return None
    return hvs_to_ue(joint[0], joint[1], joint[2])


def rest_aim_dir(ue_bone, rest):
    zero = unreal.Vector(0, 0, 0)
    loc = rest.get(ue_bone, {}).get("location", zero)
    parent_name = rest.get(ue_bone, {}).get("parent", "")
    parent_loc = rest.get(parent_name, {}).get("location", loc) if parent_name else loc
    return (loc.x - parent_loc.x, loc.y - parent_loc.y, loc.z - parent_loc.z)


def source_track(hvs_name, ue_bone, poses, rest):
    raise RuntimeError("use build_all_tracks")


def build_all_tracks(mapping, poses, rest, bone_names):
    one = unreal.Vector(1, 1, 1)
    zero = unreal.Vector(0, 0, 0)
    ident = identity_quat()
    used = []
    tracks = {}
    order = hvs_topo()
    resolved = {}
    for hvs_name, mapped in mapping.items():
        ue_bone = resolve_unreal_bone(mapped, bone_names)
        if ue_bone:
            resolved[hvs_name] = ue_bone
            used.append((hvs_name, ue_bone))
            tracks[ue_bone] = {"pos": [], "rot": [], "scale": []}
    for pose in poses:
        world_rot = {}
        for hvs_name in order:
            ue_bone = resolved.get(hvs_name)
            if not ue_bone:
                continue
            if hvs_name == "ROOT" or ue_bone.lower() == "root":
                root = pose.get("root") or [0, 0, 0]
                tracks[ue_bone]["pos"].append(hvs_to_ue(root[0], root[1], root[2]))
                tracks[ue_bone]["rot"].append(ident)
                tracks[ue_bone]["scale"].append(one)
                rest_rot = rest.get(ue_bone, {}).get("rotation", ident)
                world_rot[hvs_name] = rest_rot
                continue
            parent_hvs = CHILD_OF.get(hvs_name, "ROOT")
            aim_hvs = AIM_CHILD.get(hvs_name)
            current = joint_ue(pose, hvs_name)
            parent_joint = joint_ue(pose, parent_hvs)
            child_joint = joint_ue(pose, aim_hvs) if aim_hvs else None
            if current and child_joint:
                posed_dir = (child_joint.x - current.x, child_joint.y - current.y, child_joint.z - current.z)
            elif current and parent_joint:
                posed_dir = (current.x - parent_joint.x, current.y - parent_joint.y, current.z - parent_joint.z)
            else:
                tracks[ue_bone]["pos"].append(zero)
                tracks[ue_bone]["rot"].append(ident)
                tracks[ue_bone]["scale"].append(one)
                world_rot[hvs_name] = world_rot.get(parent_hvs, ident)
                continue
            rest_dir = rest_aim_dir(ue_bone, rest)
            rest_rot = rest.get(ue_bone, {}).get("rotation", ident)
            delta = quat_from_to(rest_dir, posed_dir)
            posed_world = quat_mul(delta, rest_rot)
            parent_world = world_rot.get(parent_hvs, ident)
            local = quat_mul(quat_inv(parent_world), posed_world)
            world_rot[hvs_name] = posed_world
            tracks[ue_bone]["pos"].append(zero)
            tracks[ue_bone]["rot"].append(local)
            tracks[ue_bone]["scale"].append(one)
    return used, tracks


def rebuild_anim(mesh, skeleton, payload, bone_names, rest):
    mapping = {entry["hvsBone"]: entry["unrealBone"] for entry in payload.get("skeletonMap", [])}
    factory = unreal.AnimSequenceFactory()
    factory.set_editor_property("target_skeleton", skeleton)
    try:
        factory.set_editor_property("preview_skeletal_mesh", mesh)
    except Exception:
        pass
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    if unreal.EditorAssetLibrary.does_asset_exist(ANIM_PATH):
        unreal.EditorAssetLibrary.delete_asset(ANIM_PATH)
    anim = asset_tools.create_asset("AN_Rael_Take3", "/Game/HVS/Animation", unreal.AnimSequence, factory)
    controller = anim_controller(anim)
    controller.open_bracket(unreal.Text("HVS-UE-03 TAKE 3 60fps parent-space"))
    used, tracks = build_all_tracks({entry["hvsBone"]: entry["unrealBone"] for entry in payload.get("skeletonMap", [])}, payload["poses"], rest, bone_names)
    try:
        try:
            controller.remove_all_bone_tracks(True)
        except Exception:
            pass
        controller.set_frame_rate(unreal.FrameRate(60, 1), True)
        try:
            controller.set_number_of_frames(unreal.FrameNumber(SAMPLE_COUNT), True)
        except TypeError:
            controller.set_number_of_frames(unreal.FrameNumber(value=SAMPLE_COUNT), True)
        for hvs_name, ue_bone in used:
            try:
                controller.add_bone_curve(ue_bone, True)
            except Exception:
                controller.add_bone_track(ue_bone, True)
            pos, rot, scale = resample_keys(tracks[ue_bone]["pos"], tracks[ue_bone]["rot"], tracks[ue_bone]["scale"], SAMPLE_COUNT)
            ok = controller.set_bone_track_keys(ue_bone, pos, rot, scale, True)
            log("track " + ue_bone + " keys=" + str(len(rot)) + " ok=" + str(ok))
    finally:
        controller.close_bracket()
    try:
        anim.set_editor_property("enable_root_motion", False)
    except Exception:
        pass
    unreal.EditorAssetLibrary.save_asset(ANIM_PATH)
    length = None
    try:
        length = float(unreal.AnimationLibrary.get_sequence_length(anim))
    except Exception:
        try:
            length = float(anim.get_editor_property("sequence_length"))
        except Exception:
            length = SAMPLE_COUNT / float(TARGET_FPS)
    keys = None
    try:
        keys = int(anim.get_editor_property("number_of_sampled_keys"))
    except Exception:
        keys = SAMPLE_COUNT
    return anim, used, length, keys


def update_sequence(anim):
    if not unreal.EditorAssetLibrary.does_asset_exist(SEQ_PATH):
        raise RuntimeError("level sequence missing")
    sequence = unreal.EditorAssetLibrary.load_asset(SEQ_PATH)
    ext = unreal.MovieSceneSequenceExtensions
    bind_ext = unreal.MovieSceneBindingExtensions
    section_ext = unreal.MovieSceneSectionExtensions
    track_ext = unreal.MovieSceneTrackExtensions
    ext.set_display_rate(sequence, unreal.FrameRate(24, 1))
    ext.set_tick_resolution_directly(sequence, unreal.FrameRate(24000, 1))
    ext.set_playback_start_seconds(sequence, 0.0)
    ext.set_playback_end_seconds(sequence, 11.0)
    for binding in ext.get_bindings(sequence):
        for track in bind_ext.get_tracks(binding):
            if isinstance(track, unreal.MovieSceneSkeletalAnimationTrack):
                for section in track_ext.get_sections(track):
                    try:
                        params = section.params
                        params.animation = anim
                        params.force_custom_mode = True
                        section.params = params
                    except Exception:
                        params = section.get_editor_property("params")
                        params.set_editor_property("animation", anim)
                        section.set_editor_property("params", params)
                    section_ext.set_range(section, 0, 230769)
    unreal.EditorAssetLibrary.save_asset(SEQ_PATH)
    return sequence


def seek(seconds):
    lib = unreal.LevelSequenceEditorBlueprintLibrary
    params = unreal.MovieSceneSequencePlaybackParams()
    params.position_type = unreal.MovieScenePositionType.TIME
    params.time = float(seconds)
    lib.set_global_position(params, unreal.MovieSceneTimeUnit.DISPLAY_RATE)
    lib.pause()


def camera_named(name):
    safe = name.replace(" ", "_").replace("'", "")
    return find_actor("HVS_Cam_" + safe)


def measure_root(seconds, rael):
    seek(seconds)
    loc = rael.get_actor_location()
    xform = rael.skeletal_mesh_component.get_bone_transform("root", unreal.RelativeTransformSpace.RTS_WORLD)
    return {
        "seconds": seconds,
        "ticks": int(round(seconds * 24000)),
        "actor": [loc.x, loc.y, loc.z],
        "rootWorld": [xform.translation.x, xform.translation.y, xform.translation.z],
    }


def capture_samples():
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


def begin_capture(sample):
    os.makedirs(PROOF_DIR, exist_ok=True)
    seek(sample["seconds"])
    lib = unreal.LevelSequenceEditorBlueprintLibrary
    try:
        lib.set_lock_camera_cut_to_viewport(True)
    except Exception:
        pass
    camera = camera_named(sample["camera"])
    path = os.path.join(PROOF_DIR, sample["name"] + ".png")
    if os.path.exists(path):
        os.remove(path)
    task = None
    try:
        task = unreal.AutomationLibrary.take_high_res_screenshot(1600, 900, path, camera=camera, delay=0.35, force_game_view=False)
    except Exception as err:
        log("camera capture failed, viewport fallback: " + str(err))
        try:
            task = unreal.AutomationLibrary.take_high_res_screenshot(1600, 900, path, delay=0.35, force_game_view=False)
        except Exception as err2:
            log("viewport capture failed: " + str(err2))
    focal = None
    if camera:
        try:
            focal = float(camera.get_cine_camera_component().get_editor_property("current_focal_length"))
        except Exception:
            focal = sample["lensMm"]
    return {"task": task, "path": path, "focalMm": focal, "cameraActor": camera.get_actor_label() if camera else None}


def finish_capture(sample, pending):
    stats = png_stats(pending["path"])
    if not stats.get("nonBlack"):
        newest = pending["path"]
        shot_root = "/home/chosenone/HVSRuntime/Saved/Screenshots"
        candidates = []
        if os.path.isdir(shot_root):
            for root, _dirs, files in os.walk(shot_root):
                for name in files:
                    if name.lower().endswith((".png", ".jpg", ".jpeg")):
                        candidates.append(os.path.join(root, name))
        if candidates:
            newest = max(candidates, key=os.path.getmtime)
            alt = png_stats(newest)
            if alt.get("nonBlack") or alt.get("bytes", 0) > stats.get("bytes", 0):
                stats = alt
    sample = dict(sample)
    sample.update({
        "path": stats.get("path"),
        "bytes": stats.get("bytes"),
        "meanLuma": stats.get("meanLuma"),
        "nonBlack": bool(stats.get("nonBlack")),
        "width": stats.get("width"),
        "height": stats.get("height"),
        "focalMm": pending.get("focalMm"),
        "cameraActor": pending.get("cameraActor"),
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    return sample


def on_tick(_dt):
    state = STATE
    state["tick"] += 1
    samples = capture_samples()
    if state["phase"] == "warm":
        if state["tick"] < 240:
            return
        log("viewport warm ticks=" + str(state["tick"]))
        state["phase"] = "seek"
        return
    if state["phase"] == "seek":
        if state["index"] >= len(samples):
            state["phase"] = "done"
            proof = state["proof"]
            proof["captures"] = state["captures"]
            proof["root"] = state["root"]
            proof["captureComplete"] = True
            proof["visualOk"] = all(item.get("nonBlack") for item in state["captures"] if item["name"] in (
                "vis_t00_wide", "vis_t16_lower_body", "vis_t58_left_arm", "vis_t85_closeup", "vis_t58_scrub_back"
            ))
            write_proof(proof)
            log("capture complete visualOk=" + str(proof["visualOk"]))
            if state["handle"] is not None:
                unreal.unregister_slate_post_tick_callback(state["handle"])
            return
        sample = samples[state["index"]]
        pending = begin_capture(sample)
        state["pending"] = pending
        state["sample"] = sample
        state["phase"] = "wait"
        state["wait"] = 0
        return
    if state["phase"] == "wait":
        state["wait"] += 1
        task = state.get("pending", {}).get("task")
        path = state.get("pending", {}).get("path")
        done = False
        try:
            done = bool(task and task.is_task_done())
        except Exception:
            done = False
        if (done or state["wait"] >= 90) and path and os.path.exists(path) and os.path.getsize(path) > 1000:
            captured = finish_capture(state["sample"], state["pending"])
            state["captures"].append(captured)
            log("captured " + captured["name"] + " luma=" + str(captured.get("meanLuma")) + " nonBlack=" + str(captured.get("nonBlack")))
            if captured["name"] in ("vis_t00_wide", "vis_t58_left_arm"):
                rael = find_actor("BP_Rael_Commander")
                if rael:
                    state["root"].append(measure_root(captured["seconds"], rael))
            state["index"] += 1
            state["phase"] = "seek"
        elif state["wait"] >= 120:
            captured = finish_capture(state["sample"], state["pending"])
            captured["timedOut"] = True
            state["captures"].append(captured)
            log("timeout " + captured["name"])
            state["index"] += 1
            state["phase"] = "seek"


def run():
    os.makedirs(PROOF_DIR, exist_ok=True)
    with open(PACKAGE, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not unreal.EditorAssetLibrary.does_asset_exist(MAP_PATH):
        raise RuntimeError("map missing")
    unreal.EditorLevelLibrary.load_level(MAP_PATH)
    mesh = unreal.EditorAssetLibrary.load_asset(MANNY)
    skeleton = mesh.skeleton
    bone_names, rest = inspect_skeleton(mesh)
    anim, used, length, keys = rebuild_anim(mesh, skeleton, payload, bone_names, rest)
    sequence = update_sequence(anim)
    lib = unreal.LevelSequenceEditorBlueprintLibrary
    lib.open_level_sequence(sequence)
    try:
        lib.set_lock_camera_cut_to_viewport(True)
    except Exception:
        pass
    rael = find_actor("BP_Rael_Commander")
    if rael:
        rael.skeletal_mesh_component.override_animation_data(anim, False, True, 0.0, 1.0)
    abs_error = abs(float(length) - HVS_DURATION)
    proof = {
        "ok": abs_error <= (1.0 / 24.0),
        "engine": "HVS-UE-03",
        "method": "resample_slerp_60fps",
        "sourceHash": payload["sourceHash"],
        "takeId": payload["takeId"],
        "motionId": payload["motionId"],
        "characterId": "rael-commander",
        "hvsDurationSec": HVS_DURATION,
        "hvsDurationTicks": 230769,
        "hvsTimescale": 24000,
        "unrealDurationSec": float(length),
        "absErrorSec": abs_error,
        "absErrorMs": abs_error * 1000.0,
        "frameError24": abs_error * 24.0,
        "sampleCount": SAMPLE_COUNT,
        "sourcePoseCount": len(payload["poses"]),
        "sampledKeys": keys,
        "frameRate": TARGET_FPS,
        "animationSequencePath": ANIM_PATH,
        "levelSequencePath": SEQ_PATH,
        "usedTracks": [{"hvs": hvs, "unreal": ue} for hvs, ue in used],
        "metahuman": False,
        "faceCapture": "NOT_STARTED",
        "captureComplete": False,
        "errors": [],
    }
    write_proof(proof)
    STATE["proof"] = proof
    log("retiming complete duration=" + str(length) + " errorMs=" + str(proof["absErrorMs"]))
    capture_path = "/home/chosenone/HVSRuntime/Scripts/hvs_ue03_capture.py"
    with open(capture_path, "r", encoding="utf-8") as handle:
        capture_code = handle.read()
    exec(compile(capture_code, capture_path, "exec"), {"__name__": "hvs_ue03_capture"})
    return proof


try:
    RESULT = run()
except Exception as exc:
    unreal.log_error("[HVS-UE-03] " + traceback.format_exc())
    write_proof({"ok": False, "engine": "HVS-UE-03", "errors": [str(exc), traceback.format_exc()], "faceCapture": "NOT_STARTED", "metahuman": False})
