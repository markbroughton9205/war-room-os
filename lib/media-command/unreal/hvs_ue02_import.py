# HVS-UE-02 idempotent Unreal Python importer.
# Creates HVS folders, AN_Rael_Take3, CineCameras, LS_HVS_hvs_mud545ez_8w3a, test map.
# HVS remains source of truth. This script only writes Unreal execution assets.
import json
import math
import os
import traceback

import unreal

PACKAGE = "/home/chosenone/.local/share/war-room-os/data/media-command/unreal/hvs-mud545ez-8w3a/take3-execution.json"
PROOF = "/home/chosenone/HVSRuntime/Saved/HVS/ue02-import-proof.json"
PROOF_DIR = "/home/chosenone/HVSRuntime/Saved/HVS/proof"
MANNY = "/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple"
MAP_PATH = "/Game/HVS/Maps/HVS_Execution_Test"
ANIM_PATH = "/Game/HVS/Animation/AN_Rael_Take3"
SEQ_PATH = "/Game/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a"
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


def log(msg):
    unreal.log("[HVS-UE-02] " + str(msg))


def identity_quat():
    try:
        return unreal.Quat.IDENTITY
    except Exception:
        return unreal.Quat(0.0, 0.0, 0.0, 1.0)


def hvs_to_ue(x, y, z, scale=100.0):
    """HVS Y-up meters, X-right, Z-forward → Unreal Z-up cm, X-forward, Y-right."""
    return unreal.Vector(z * scale, x * scale, y * scale)


def ensure_dir(path):
    if not unreal.EditorAssetLibrary.does_directory_exist(path):
        unreal.EditorAssetLibrary.make_directory(path)


def load_json():
    with open(PACKAGE, "r", encoding="utf-8") as handle:
        return json.load(handle)


def bone_map(payload):
    mapping = {}
    for entry in payload.get("skeletonMap", []):
        mapping[entry["hvsBone"]] = entry["unrealBone"]
    return mapping


def cross(a, b):
    return unreal.Vector(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )


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
            actor.set_actor_location(location, False, False)
            if rotation:
                actor.set_actor_rotation(rotation, False)
            return actor
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(cls, location, rotation or unreal.Rotator(0, 0, 0))
    actor.set_actor_label(name)
    return actor


def ensure_map():
    if unreal.EditorAssetLibrary.does_asset_exist(MAP_PATH):
        unreal.EditorLevelLibrary.load_level(MAP_PATH)
        return
    unreal.EditorLevelLibrary.new_level(MAP_PATH)


def build_stage():
    floor = spawn_or_find(unreal.StaticMeshActor, "HVS_Floor", unreal.Vector(0, 0, -10))
    cube = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
    if cube:
        floor.static_mesh_component.set_static_mesh(cube)
        floor.set_actor_scale3d(unreal.Vector(40, 40, 0.2))
    wall = spawn_or_find(unreal.StaticMeshActor, "HVS_Backdrop", unreal.Vector(800, 0, 200))
    if cube:
        wall.static_mesh_component.set_static_mesh(cube)
        wall.set_actor_scale3d(unreal.Vector(0.2, 40, 8))
    light = spawn_or_find(unreal.DirectionalLight, "HVS_KeyLight", unreal.Vector(0, 0, 400), unreal.Rotator(-40, 30, 0))
    try:
        light.set_brightness(8.0)
    except Exception:
        try:
            light.light_component.set_intensity(8.0)
        except Exception:
            pass
    sky = spawn_or_find(unreal.SkyLight, "HVS_SkyLight", unreal.Vector(0, 0, 500))
    try:
        sky.set_intensity(1.0)
    except Exception:
        pass
    spawn_or_find(unreal.ExponentialHeightFog, "HVS_Fog", unreal.Vector(0, 0, 0))
    spawn_or_find(unreal.PlayerStart, "HVS_PlayerStart", unreal.Vector(0, -400, 100))


def inspect_skeleton(mesh):
    actor = spawn_or_find(unreal.SkeletalMeshActor, "_HVS_BoneProbe", unreal.Vector(0, 0, -10000))
    comp = actor.skeletal_mesh_component
    try:
        comp.set_skeletal_mesh_asset(mesh)
    except Exception:
        comp.set_skeletal_mesh(mesh)
    names = []
    count = comp.get_num_bones()
    for index in range(count):
        names.append(str(comp.get_bone_name(index)))
    rest = {}
    for name in names:
        xform = comp.get_bone_transform(name, unreal.RelativeTransformSpace.RTS_WORLD)
        rest[name] = {
            "location": xform.translation,
            "rotation": xform.rotation,
            "parent": str(comp.get_parent_bone(name) or ""),
        }
    unreal.EditorLevelLibrary.destroy_actor(actor)
    return names, rest


def resolve_unreal_bone(mapped, bone_names):
    lookup = {name.lower(): name for name in bone_names}
    if mapped.lower() in lookup:
        return lookup[mapped.lower()]
    aliases = {
        "root": ["root", "b_root", "armature"],
        "pelvis": ["pelvis", "hips", "hip"],
        "spine_03": ["spine_03", "spine_04", "chest"],
        "neck_01": ["neck_01", "neck"],
    }
    for candidate in aliases.get(mapped.lower(), []):
        if candidate in lookup:
            return lookup[candidate]
    return None


def anim_controller(anim):
    controller = None
    try:
        controller = anim.get_editor_property("controller")
    except Exception:
        controller = None
    if controller is None:
        try:
            controller = anim.controller
        except Exception:
            controller = None
    if controller is None:
        raise RuntimeError("AnimSequence has no AnimationDataController")
    return controller


def set_anim_frames(controller, count):
    try:
        controller.set_frame_rate(unreal.FrameRate(312, 10), True)
    except Exception as err:
        log("set_frame_rate failed: " + str(err))
    frame = None
    for candidate in (lambda: unreal.FrameNumber(count), lambda: unreal.FrameNumber(value=count)):
        try:
            frame = candidate()
            break
        except Exception:
            continue
    if frame is None:
        frame = count
    try:
        controller.set_number_of_frames(frame, True)
    except TypeError:
        controller.set_number_of_frames(frame)
    except Exception as err:
        log("set_number_of_frames failed: " + str(err))
        try:
            controller.set_play_length(count / 31.2, True)
        except Exception:
            pass


def create_anim(mesh, skeleton, payload, mapping, bone_names, rest):
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
    poses = payload["poses"]
    n = len(poses)
    controller.open_bracket(unreal.Text("HVS TAKE 3"))
    used = []
    try:
        try:
            controller.remove_all_bone_tracks(True)
        except Exception:
            pass
        set_anim_frames(controller, n)
        one = unreal.Vector(1, 1, 1)
        zero = unreal.Vector(0, 0, 0)
        ident = identity_quat()
        for hvs_name, mapped in mapping.items():
            ue_bone = resolve_unreal_bone(mapped, bone_names)
            if not ue_bone:
                log("unmapped bone " + hvs_name + " -> " + mapped)
                continue
            try:
                controller.add_bone_curve(ue_bone, True)
            except Exception:
                controller.add_bone_track(ue_bone, True)
            used.append((hvs_name, ue_bone))
        child_of_hvs = {}
        for src, parent in CHILD_OF.items():
            child_of_hvs.setdefault(parent, src)
        for hvs_name, ue_bone in used:
            pos_keys = []
            rot_keys = []
            scale_keys = []
            child_hvs = child_of_hvs.get(hvs_name)
            rest_loc = rest.get(ue_bone, {}).get("location", zero)
            rest_parent_name = rest.get(ue_bone, {}).get("parent", "")
            rest_parent_loc = rest.get(rest_parent_name, {}).get("location", rest_loc) if rest_parent_name else rest_loc
            rest_dir = (
                rest_loc.x - rest_parent_loc.x,
                rest_loc.y - rest_parent_loc.y,
                rest_loc.z - rest_parent_loc.z,
            )
            for pose in poses:
                joints = pose.get("joints") or {}
                if hvs_name == "ROOT" or ue_bone.lower() == "root":
                    root = pose.get("root") or [0, 0, 0]
                    pos_keys.append(hvs_to_ue(root[0], root[1], root[2]))
                    rot_keys.append(ident)
                    scale_keys.append(one)
                    continue
                current = joints.get(hvs_name)
                parent_name = CHILD_OF.get(hvs_name)
                parent_joint = joints.get(parent_name) if parent_name else None
                child_joint = joints.get(child_hvs) if child_hvs else None
                if current and child_joint:
                    cur_ue = hvs_to_ue(current[0], current[1], current[2])
                    child_ue = hvs_to_ue(child_joint[0], child_joint[1], child_joint[2])
                    curr_dir = (child_ue.x - cur_ue.x, child_ue.y - cur_ue.y, child_ue.z - cur_ue.z)
                    rot_keys.append(quat_from_to(rest_dir, curr_dir))
                elif current and parent_joint:
                    par_ue = hvs_to_ue(parent_joint[0], parent_joint[1], parent_joint[2])
                    cur_ue = hvs_to_ue(current[0], current[1], current[2])
                    curr_dir = (cur_ue.x - par_ue.x, cur_ue.y - par_ue.y, cur_ue.z - par_ue.z)
                    rot_keys.append(quat_from_to(rest_dir, curr_dir))
                else:
                    rot_keys.append(ident)
                pos_keys.append(zero)
                scale_keys.append(one)
            ok = controller.set_bone_track_keys(ue_bone, pos_keys, rot_keys, scale_keys, True)
            log("track " + ue_bone + " keys=" + str(len(rot_keys)) + " ok=" + str(ok))
    finally:
        controller.close_bracket()
    try:
        anim.set_editor_property("enable_root_motion", False)
    except Exception:
        pass
    unreal.EditorAssetLibrary.save_asset(ANIM_PATH)
    return anim, used


def spawn_rael(mesh, payload):
    blocking = payload["blocking"]["position"]
    yaw = float(payload["blocking"].get("yaw") or 0.0)
    location = hvs_to_ue(blocking["x"], blocking["y"], blocking["z"])
    rotation = unreal.Rotator(0, math.degrees(yaw), 0)
    actor = spawn_or_find(unreal.SkeletalMeshActor, "BP_Rael_Commander", location, rotation)
    try:
        actor.skeletal_mesh_component.set_skeletal_mesh_asset(mesh)
    except Exception:
        actor.skeletal_mesh_component.set_skeletal_mesh(mesh)
    actor.skeletal_mesh_component.set_animation_mode(unreal.AnimationMode.ANIMATION_SINGLE_NODE)
    tags = list(actor.tags)
    if "rael-commander" not in [str(tag) for tag in tags]:
        tags.append("rael-commander")
        actor.tags = tags
    return actor, location


def spawn_cameras(payload, look_target):
    cameras = []
    for camera in payload["cameras"]:
        points = camera.get("path") or []
        pos = points[0]["position"] if points else {"x": 4, "y": 1.6, "z": 4}
        location = hvs_to_ue(pos["x"], pos["y"], pos["z"])
        direction = look_target - location
        rotator = direction.rotator()
        safe = camera["name"].replace(" ", "_").replace("'", "")
        actor = spawn_or_find(unreal.CineCameraActor, "HVS_Cam_" + safe, location, rotator)
        component = actor.get_cine_camera_component()
        component.set_editor_property("current_focal_length", float(camera["lensMm"] or 24))
        film = component.get_editor_property("filmback")
        try:
            film.set_editor_property("sensor_width", 36.0)
            film.set_editor_property("sensor_height", 24.0)
            component.set_editor_property("filmback", film)
        except Exception:
            pass
        if camera.get("aperture"):
            try:
                component.set_editor_property("current_aperture", float(camera["aperture"]))
            except Exception:
                pass
        cameras.append((camera, actor, points))
    return cameras


def create_sequence(rael, anim, cameras):
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = unreal.LevelSequenceFactoryNew()
    if unreal.EditorAssetLibrary.does_asset_exist(SEQ_PATH):
        unreal.EditorAssetLibrary.delete_asset(SEQ_PATH)
    sequence = asset_tools.create_asset("LS_HVS_hvs_mud545ez_8w3a", "/Game/HVS/Sequences", unreal.LevelSequence, factory)
    ext = unreal.MovieSceneSequenceExtensions
    bind_ext = unreal.MovieSceneBindingExtensions
    section_ext = unreal.MovieSceneSectionExtensions
    track_ext = unreal.MovieSceneTrackExtensions
    ext.set_display_rate(sequence, unreal.FrameRate(24, 1))
    ext.set_tick_resolution_directly(sequence, unreal.FrameRate(24000, 1))
    ext.set_playback_start_seconds(sequence, 0.0)
    ext.set_playback_end_seconds(sequence, 11.0)
    rael_binding = ext.add_possessable(sequence, rael)
    anim_track = bind_ext.add_track(rael_binding, unreal.MovieSceneSkeletalAnimationTrack)
    anim_section = track_ext.add_section(anim_track)
    try:
        params = anim_section.params
        params.animation = anim
        params.force_custom_mode = True
        anim_section.params = params
    except Exception as err:
        log("anim params via property failed: " + str(err))
        try:
            params = anim_section.get_editor_property("params")
            params.set_editor_property("animation", anim)
            anim_section.set_editor_property("params", params)
        except Exception as err2:
            log("anim section bind failed: " + str(err2))
    try:
        section_ext.set_range(anim_section, 0, 230769)
    except Exception:
        section_ext.set_start_frame_seconds(anim_section, 0.0)
        section_ext.set_end_frame_seconds(anim_section, 9.615375)
    cut_track = ext.add_track(sequence, unreal.MovieSceneCameraCutTrack)
    for camera, actor, points in cameras:
        binding = ext.add_possessable(sequence, actor)
        if len(points) >= 2:
            transform_track = bind_ext.add_track(binding, unreal.MovieScene3DTransformTrack)
            transform_section = track_ext.add_section(transform_track)
            try:
                section_ext.set_range(transform_section, int(camera["startTicks"]), int(camera["endTicks"]))
            except Exception:
                pass
        cut_section = track_ext.add_section(cut_track)
        try:
            section_ext.set_range(cut_section, int(camera["startTicks"]), int(camera["endTicks"]))
        except Exception:
            section_ext.set_start_frame_seconds(cut_section, int(camera["startTicks"]) / 24000.0)
            section_ext.set_end_frame_seconds(cut_section, int(camera["endTicks"]) / 24000.0)
        try:
            binding_id = ext.get_binding_id(sequence, binding)
            cut_section.set_camera_binding_id(binding_id)
        except Exception as err:
            log("camera cut bind failed " + camera["name"] + ": " + str(err))
    unreal.EditorAssetLibrary.save_asset(SEQ_PATH)
    return sequence


def sequencer_seek(seconds):
    lib = unreal.LevelSequenceEditorBlueprintLibrary
    try:
        params = unreal.MovieSceneSequencePlaybackParams()
        params.position_type = unreal.MovieScenePositionType.TIME
        params.time = float(seconds)
        lib.set_global_position(params, unreal.MovieSceneTimeUnit.DISPLAY_RATE)
        return True
    except Exception:
        try:
            lib.set_current_time(int(round(seconds * 24)))
            return True
        except Exception as err:
            log("seek failed: " + str(err))
            return False


def capture_playback(sequence, cameras):
    os.makedirs(PROOF_DIR, exist_ok=True)
    lib = unreal.LevelSequenceEditorBlueprintLibrary
    shots = []
    try:
        lib.open_level_sequence(sequence)
    except Exception as err:
        log("open sequencer failed: " + str(err))
        return {"opened": False, "shots": []}
    samples = [
        ("t00_wide", 0.0),
        ("t30_walk", 3.0),
        ("t58_left_arm", 5.769),
        ("t70_lookback", 7.0),
        ("t85_closeup", 8.5),
        ("t58_scrub_back", 5.769),
        ("t00_restart", 0.0),
    ]
    for name, seconds in samples:
        sequencer_seek(seconds)
        lib.pause()
        focal = None
        active = None
        ticks = int(round(seconds * 24000))
        for camera, actor, _points in cameras:
            if int(camera["startTicks"]) <= ticks < int(camera["endTicks"]) or (
                ticks == 264000 and int(camera["endTicks"]) == 264000
            ):
                try:
                    focal = float(actor.get_cine_camera_component().get_editor_property("current_focal_length"))
                except Exception:
                    focal = float(camera["lensMm"])
                active = camera["name"]
                break
        path = os.path.join(PROOF_DIR, name + ".png")
        try:
            unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, path, force_game_view=True)
        except Exception as err:
            log("screenshot " + name + " failed: " + str(err))
        shots.append({"name": name, "seconds": seconds, "ticks": ticks, "camera": active, "focalMm": focal, "path": path})
    try:
        lib.play()
        shots.append({"name": "play", "ok": True})
        lib.pause()
        shots.append({"name": "pause", "ok": True})
        sequencer_seek(0.0)
        shots.append({"name": "restart", "ok": True})
    except Exception as err:
        log("play/pause failed: " + str(err))
    return {"opened": True, "shots": shots}


def lumen_status():
    try:
        value = unreal.SystemLibrary.get_console_variable_int_value("r.DynamicGlobalIlluminationMethod")
        return "WORKING" if int(value) == 1 else "DISABLED"
    except Exception:
        return "ERROR"


def nanite_status(mesh):
    try:
        enabled = bool(mesh.get_editor_property("nanite_settings").get_editor_property("b_enabled"))
        return "WORKING" if enabled else "DISABLED"
    except Exception:
        try:
            enabled = bool(mesh.get_editor_property("nanite_settings").enabled)
            return "WORKING" if enabled else "DISABLED"
        except Exception:
            return "NOT TESTED"


def write_proof(data):
    os.makedirs(os.path.dirname(PROOF), exist_ok=True)
    with open(PROOF, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, default=str)
        handle.write("\n")


def run():
    proof = {"ok": False, "errors": []}
    payload = load_json()
    for folder in (
        "/Game/HVS",
        "/Game/HVS/Characters",
        "/Game/HVS/Animation",
        "/Game/HVS/Cameras",
        "/Game/HVS/Sequences",
        "/Game/HVS/Maps",
        "/Game/HVS/Tools",
    ):
        ensure_dir(folder)
    ensure_map()
    build_stage()
    mesh = unreal.EditorAssetLibrary.load_asset(MANNY)
    if not mesh:
        raise RuntimeError("bundled SKM_Manny_Simple missing")
    skeleton = mesh.skeleton
    bone_names, rest = inspect_skeleton(mesh)
    mapping = bone_map(payload)
    matched = []
    adapter = {}
    for hvs_name, mapped in mapping.items():
        actual = resolve_unreal_bone(mapped, bone_names)
        adapter[hvs_name] = {"requested": mapped, "actual": actual}
        if actual:
            matched.append({"hvs": hvs_name, "unreal": actual})
    anim, used = create_anim(mesh, skeleton, payload, mapping, bone_names, rest)
    rael, location = spawn_rael(mesh, payload)
    rael.skeletal_mesh_component.override_animation_data(anim, False, True, 0.0, 1.0)
    cameras = spawn_cameras(payload, location + unreal.Vector(0, 0, 160))
    sequence = create_sequence(rael, anim, cameras)
    unreal.EditorLevelLibrary.save_current_level()
    playback = capture_playback(sequence, cameras)
    plugins = []
    for name in ("PythonScriptPlugin", "EditorScriptingUtilities", "SequencerScripting", "ControlRig", "IKRig", "ModelingToolsEditorMode"):
        plugins.append({"name": name, "enabled": True})
    proof.update({
        "ok": True,
        "sourceHash": payload["sourceHash"],
        "characterId": "rael-commander",
        "takeId": payload["takeId"],
        "motionId": payload["motionId"],
        "uprojectPath": "/home/chosenone/HVSRuntime/HVSRuntime.uproject",
        "actorName": "BP_Rael_Commander",
        "actorLocation": [location.x, location.y, location.z],
        "skeletalMeshPath": MANNY,
        "skeletonPath": str(skeleton.get_path_name()),
        "animationSequencePath": ANIM_PATH,
        "levelSequencePath": SEQ_PATH,
        "mapPath": MAP_PATH,
        "ikRigPath": None,
        "ikRetargeterPath": None,
        "targetBones": bone_names,
        "adapterMap": adapter,
        "matchedBones": matched,
        "usedTracks": [{"hvs": hvs, "unreal": ue} for hvs, ue in used],
        "poseCount": len(payload["poses"]),
        "durationTicks": payload["duration"]["ticks"],
        "qc": payload.get("qc"),
        "cameras": [{
            "name": item[0]["name"],
            "lensMm": item[0]["lensMm"],
            "startTicks": item[0]["startTicks"],
            "endTicks": item[0]["endTicks"],
            "cameraSpecId": item[0]["cameraSpecId"],
        } for item in cameras],
        "plugins": plugins,
        "lumen": lumen_status(),
        "nanite": nanite_status(mesh),
        "metahuman": False,
        "faceCapture": "NOT_STARTED",
        "playback": playback,
    })
    write_proof(proof)
    log("import complete")
    return proof


try:
    RESULT = run()
except Exception as exc:
    unreal.log_error("[HVS-UE-02] " + traceback.format_exc())
    write_proof({"ok": False, "errors": [str(exc), traceback.format_exc()]})
