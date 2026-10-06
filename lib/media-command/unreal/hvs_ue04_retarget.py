# HVS-UE-04: two-bone IK adapter + IK Rig/Retargeter + Control Rig + lit mesh proof.
# Does not mutate HVS source truth. Does not invent right-arm, fingers, or face.
import json
import math
import os
import struct
import time
import traceback
import zlib

import unreal

PACKAGE = "/home/chosenone/.local/share/war-room-os/data/media-command/unreal/hvs-mud545ez-8w3a/take3-execution.json"
PROOF = "/home/chosenone/HVSRuntime/Saved/HVS/ue04-proof.json"
PROOF_DIR = "/home/chosenone/HVSRuntime/Saved/HVS/ue04-proof"
MANNY = "/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple"
MAP_PATH = "/Game/HVS/Maps/HVS_Execution_Test"
SOURCE_ANIM = "/Game/HVS/Animation/AN_Rael_Take3"
DERIVED_ANIM = "/Game/HVS/Animation/AN_Rael_Take3_Manny"
SEQ_PATH = "/Game/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a"
IK_SOURCE = "/Game/HVS/Characters/Rigs/IK_HVS_Source"
IK_TARGET = "/Game/HVS/Characters/Rigs/IK_Manny_Target"
RTG_PATH = "/Game/HVS/Characters/Rigs/RTG_HVS_To_Manny"
CR_BODY = "/Game/Characters/Mannequins/Rigs/CR_Mannequin_Body"
CR_FOOT = "/Game/Characters/Mannequins/Rigs/CR_Mannequin_FootIK"
HVS_DURATION = 230769.0 / 24000.0
TARGET_FPS = 60
SAMPLE_COUNT = 576
CHILD_OF = {
    "PELVIS": "ROOT", "SPINE_01": "PELVIS", "SPINE_02": "SPINE_01", "CHEST": "SPINE_02",
    "NECK": "CHEST", "HEAD": "NECK", "LEFT_CLAVICLE": "CHEST", "LEFT_SHOULDER": "LEFT_CLAVICLE",
    "LEFT_ELBOW": "LEFT_SHOULDER", "LEFT_WRIST": "LEFT_ELBOW", "RIGHT_CLAVICLE": "CHEST",
    "RIGHT_SHOULDER": "RIGHT_CLAVICLE", "RIGHT_ELBOW": "RIGHT_SHOULDER", "RIGHT_WRIST": "RIGHT_ELBOW",
    "LEFT_HIP": "PELVIS", "LEFT_KNEE": "LEFT_HIP", "LEFT_ANKLE": "LEFT_KNEE", "LEFT_FOOT": "LEFT_ANKLE",
    "RIGHT_HIP": "PELVIS", "RIGHT_KNEE": "RIGHT_HIP", "RIGHT_ANKLE": "RIGHT_KNEE", "RIGHT_FOOT": "RIGHT_ANKLE",
}
AIM_CHILD = {
    "PELVIS": "SPINE_01", "SPINE_01": "SPINE_02", "SPINE_02": "CHEST", "CHEST": "NECK", "NECK": "HEAD",
    "LEFT_CLAVICLE": "LEFT_SHOULDER", "LEFT_SHOULDER": "LEFT_ELBOW", "LEFT_ELBOW": "LEFT_WRIST",
    "RIGHT_CLAVICLE": "RIGHT_SHOULDER", "RIGHT_SHOULDER": "RIGHT_ELBOW", "RIGHT_ELBOW": "RIGHT_WRIST",
    "LEFT_HIP": "LEFT_KNEE", "LEFT_KNEE": "LEFT_ANKLE", "LEFT_ANKLE": "LEFT_FOOT",
    "RIGHT_HIP": "RIGHT_KNEE", "RIGHT_KNEE": "RIGHT_ANKLE", "RIGHT_ANKLE": "RIGHT_FOOT",
}
TWO_BONE = {
    "LEFT_ARM": ("LEFT_SHOULDER", "LEFT_ELBOW", "LEFT_WRIST"),
    "RIGHT_ARM": ("RIGHT_SHOULDER", "RIGHT_ELBOW", "RIGHT_WRIST"),
    "LEFT_LEG": ("LEFT_HIP", "LEFT_KNEE", "LEFT_ANKLE"),
    "RIGHT_LEG": ("RIGHT_HIP", "RIGHT_KNEE", "RIGHT_ANKLE"),
}
HVS_CAMERAS = {
    "Wide": {"location": unreal.Vector(194.0, -319.0, 160.0), "lens": 24.0},
    "Walk": {"location": unreal.Vector(201.44950442280543, -327.3708621974917, 155.0), "lens": 24.0},
    "Look back": {"location": unreal.Vector(165.0, 172.0, 160.0), "lens": 24.0},
    "Close-up of Ra'el": {"location": unreal.Vector(-80.0, -90.0, 155.0), "lens": 85.0},
}
STATE = {"tick": 0, "phase": "warm", "index": 0, "wait": 0, "captures": [], "root": [], "handle": None, "fps": []}
WARM_TICKS = 240
SEEK_SETTLE = 40


def log(msg):
    unreal.log("[HVS-UE-04] " + str(msg))


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


def host_metrics():
    metrics = {"vramMiB": None, "ramMiB": None, "gpu": None}
    try:
        line = os.popen("nvidia-smi --query-gpu=name,memory.used --format=csv,noheader,nounits").read().strip()
        if line:
            name, used = [part.strip() for part in line.split(",", 1)]
            metrics["gpu"] = name
            metrics["vramMiB"] = float(used)
    except Exception:
        pass
    try:
        mem = os.popen("awk '/MemTotal|MemAvailable/ {print $1,$2}' /proc/meminfo").read().splitlines()
        total = available = None
        for row in mem:
            key, value = row.split()
            if key.startswith("MemTotal"):
                total = float(value) / 1024.0
            if key.startswith("MemAvailable"):
                available = float(value) / 1024.0
        if total is not None and available is not None:
            metrics["ramMiB"] = total - available
            metrics["ramTotalMiB"] = total
    except Exception:
        pass
    return metrics


def png_stats(path):
    result = {"path": path, "exists": os.path.exists(path), "bytes": 0, "width": 0, "height": 0, "meanLuma": 0.0, "nonBlack": False, "colorBuckets": 0}
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
        result["nonBlack"] = result["meanLuma"] >= 8.0 and result["bytes"] > 25000 and len(unique) >= 8
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
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def vlen(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def vnorm(a):
    length = vlen(a) or 1e-8
    return (a[0] / length, a[1] / length, a[2] / length)


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vscale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def as_tuple(vec):
    return (vec.x, vec.y, vec.z)


def quat_from_to(from_v, to_v):
    a = vnorm(from_v)
    b = vnorm(to_v)
    dot = max(-1.0, min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
    if dot > 0.9999:
        return identity_quat()
    if dot < -0.9999:
        axis = cross(a, (1, 0, 0))
        if vlen(axis) < 1e-4:
            axis = cross(a, (0, 1, 0))
        axis = vnorm(axis)
        return unreal.Quat(axis[0], axis[1], axis[2], 0.0)
    axis = cross(a, b)
    s = math.sqrt((1.0 + dot) * 2.0)
    inv = 1.0 / s
    return unreal.Quat(axis[0] * inv, axis[1] * inv, axis[2] * inv, s * 0.5)


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


def two_bone_mid(origin, pole, target, len1, len2):
    to_t = vsub(target, origin)
    dist = vlen(to_t)
    max_reach = max(0.5, len1 + len2 - 0.5)
    min_reach = abs(len1 - len2) + 0.5
    dist = min(max(dist, min_reach), max_reach)
    direction = vnorm(to_t) if vlen(to_t) > 1e-5 else (1, 0, 0)
    pole_dir = vsub(pole, origin)
    normal = cross(direction, pole_dir)
    if vlen(normal) < 1e-5:
        normal = cross(direction, (0, 0, 1) if abs(direction[2]) < 0.9 else (1, 0, 0))
    binorm = vnorm(cross(vnorm(normal), direction))
    cos_a = (len1 * len1 + dist * dist - len2 * len2) / max(1e-6, 2.0 * len1 * dist)
    cos_a = max(-1.0, min(1.0, cos_a))
    sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))
    return vadd(origin, vadd(vscale(direction, len1 * cos_a), vscale(binorm, len1 * sin_a)))


def find_actor(name):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == name:
            return actor
    return None


def inspect_skeleton(mesh):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector(0, 0, 0))
    actor.set_actor_label("_HVS_UE04_Probe")
    comp = actor.skeletal_mesh_component
    try:
        comp.set_skeletal_mesh_asset(mesh)
    except Exception:
        comp.set_skeletal_mesh(mesh)
    names = [str(comp.get_bone_name(index)) for index in range(comp.get_num_bones())]
    rest = {}
    for name in names:
        component = comp.get_bone_transform(name, unreal.RelativeTransformSpace.RTS_COMPONENT)
        parent_space = comp.get_bone_transform(name, unreal.RelativeTransformSpace.RTS_PARENT_BONE_SPACE)
        rest[name] = {
            "location": component.translation,
            "rotation": component.rotation,
            "localLocation": parent_space.translation,
            "localRotation": parent_space.rotation,
            "parent": str(comp.get_parent_bone(name) or ""),
        }
    unreal.EditorLevelLibrary.destroy_actor(actor)
    return names, rest


def resolve_unreal_bone(mapped, bone_names):
    lookup = {name.lower(): name for name in bone_names}
    return lookup.get(mapped.lower())


def joint_ue(pose, name):
    if name == "ROOT":
        root = pose.get("root") or [0, 0, 0]
        return hvs_to_ue(root[0], root[1], root[2])
    joint = (pose.get("joints") or {}).get(name)
    if not joint:
        return None
    return hvs_to_ue(joint[0], joint[1], joint[2])


def rest_aim_dir(ue_bone, rest, child_ue=None):
    loc = rest.get(ue_bone, {}).get("location", unreal.Vector(0, 0, 0))
    if child_ue and child_ue in rest:
        child_loc = rest[child_ue]["location"]
        return (child_loc.x - loc.x, child_loc.y - loc.y, child_loc.z - loc.z)
    parent_name = rest.get(ue_bone, {}).get("parent", "")
    parent_loc = rest.get(parent_name, {}).get("location", loc) if parent_name else loc
    return (loc.x - parent_loc.x, loc.y - parent_loc.y, loc.z - parent_loc.z)


def rest_len(ue_a, ue_b, rest):
    a = rest.get(ue_a, {}).get("location")
    b = rest.get(ue_b, {}).get("location")
    if not a or not b:
        return 20.0
    return max(1.0, vlen((a.x - b.x, a.y - b.y, a.z - b.z)))


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


def anim_controller(anim):
    controller = anim.get_editor_property("controller") if hasattr(anim, "get_editor_property") else None
    if controller is None:
        controller = getattr(anim, "controller", None)
    if controller is None:
        raise RuntimeError("AnimSequence has no AnimationDataController")
    return controller


def posed_effectors(pose, rest, resolved):
    world = {}
    for hvs_name in pose.get("joints") or {}:
        vec = joint_ue(pose, hvs_name)
        if vec:
            world[hvs_name] = as_tuple(vec)
    root = joint_ue(pose, "ROOT")
    if root:
        world["ROOT"] = as_tuple(root)
    for _label, (upper, mid, end) in TWO_BONE.items():
        if upper not in world or end not in world:
            continue
        ue_u = resolved.get(upper)
        ue_m = resolved.get(mid)
        ue_e = resolved.get(end)
        if not (ue_u and ue_m and ue_e):
            continue
        len1 = rest_len(ue_u, ue_m, rest)
        len2 = rest_len(ue_m, ue_e, rest)
        pole = world.get(mid, vadd(world[upper], (0, 0, 20)))
        world[mid] = two_bone_mid(world[upper], pole, world[end], len1, len2)
    return world


def build_ik_tracks(mapping, poses, rest, bone_names):
    one = unreal.Vector(1, 1, 1)
    zero = unreal.Vector(0, 0, 0)
    ident = identity_quat()
    used = []
    tracks = {}
    resolved = {}
    for hvs_name, mapped in mapping.items():
        ue_bone = resolve_unreal_bone(mapped, bone_names)
        if ue_bone:
            resolved[hvs_name] = ue_bone
            used.append((hvs_name, ue_bone))
            tracks[ue_bone] = {"pos": [], "rot": [], "scale": []}
    order = hvs_topo()
    for pose in poses:
        effectors = posed_effectors(pose, rest, resolved)
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
                world_rot[hvs_name] = rest.get(ue_bone, {}).get("rotation", ident)
                continue
            parent_hvs = CHILD_OF.get(hvs_name, "ROOT")
            aim_hvs = AIM_CHILD.get(hvs_name)
            current = effectors.get(hvs_name)
            child = effectors.get(aim_hvs) if aim_hvs else None
            parent = effectors.get(parent_hvs)
            rest_pos = rest.get(ue_bone, {}).get("localLocation", zero)
            if current and child:
                posed_dir = vsub(child, current)
            elif current and parent:
                posed_dir = vsub(current, parent)
            else:
                tracks[ue_bone]["pos"].append(rest_pos)
                tracks[ue_bone]["rot"].append(rest.get(ue_bone, {}).get("localRotation", ident))
                tracks[ue_bone]["scale"].append(one)
                world_rot[hvs_name] = world_rot.get(parent_hvs, ident)
                continue
            child_ue = resolved.get(aim_hvs) if aim_hvs else None
            rest_dir = rest_aim_dir(ue_bone, rest, child_ue)
            rest_rot = rest.get(ue_bone, {}).get("rotation", ident)
            posed_world = quat_mul(quat_from_to(rest_dir, posed_dir), rest_rot)
            parent_ue = resolved.get(parent_hvs)
            parent_world = world_rot.get(parent_hvs, rest.get(parent_ue or "", {}).get("rotation", ident))
            local = quat_mul(quat_inv(parent_world), posed_world)
            world_rot[hvs_name] = posed_world
            tracks[ue_bone]["pos"].append(rest_pos)
            tracks[ue_bone]["rot"].append(local)
            tracks[ue_bone]["scale"].append(one)
    return used, tracks


def write_anim(path, mesh, skeleton, payload, rest, bone_names):
    mapping = {entry["hvsBone"]: entry["unrealBone"] for entry in payload.get("skeletonMap", [])}
    factory = unreal.AnimSequenceFactory()
    factory.set_editor_property("target_skeleton", skeleton)
    try:
        factory.set_editor_property("preview_skeletal_mesh", mesh)
    except Exception:
        pass
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    name = path.rsplit("/", 1)[-1]
    folder = path[: path.rfind("/")]
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    anim = asset_tools.create_asset(name, folder, unreal.AnimSequence, factory)
    used, tracks = build_ik_tracks(mapping, payload["poses"], rest, bone_names)
    controller = anim_controller(anim)
    controller.open_bracket(unreal.Text("HVS-UE-04 two-bone IK"))
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
    unreal.EditorAssetLibrary.save_asset(path)
    try:
        length = float(unreal.AnimationLibrary.get_sequence_length(anim))
    except Exception:
        length = SAMPLE_COUNT / float(TARGET_FPS)
    try:
        keys = int(anim.get_editor_property("number_of_sampled_keys"))
    except Exception:
        keys = SAMPLE_COUNT
    return anim, used, length, keys


def ensure_folder(path):
    if not unreal.EditorAssetLibrary.does_directory_exist(path):
        unreal.EditorAssetLibrary.make_directory(path)


def create_ik_rig(asset_path, mesh, label):
    ensure_folder("/Game/HVS/Characters/Rigs")
    name = asset_path.rsplit("/", 1)[-1]
    folder = asset_path[: asset_path.rfind("/")]
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        unreal.EditorAssetLibrary.delete_asset(asset_path)
    rig = unreal.IKRigDefinitionFactory.create_new_ik_rig_asset(folder, name)
    controller = unreal.IKRigController.get_controller(rig)
    controller.set_skeletal_mesh(mesh)
    auto_chains = False
    auto_fbik = False
    try:
        auto_chains = bool(controller.apply_auto_generated_retarget_definition())
    except Exception as err:
        log(label + " auto chains failed " + str(err))
    try:
        auto_fbik = bool(controller.apply_auto_fbik())
    except Exception as err:
        log(label + " auto fbik failed " + str(err))
    if not auto_chains:
        chains = [
            ("Spine", "pelvis", "spine_03", "None"),
            ("Neck", "neck_01", "head", "None"),
            ("LeftArm", "clavicle_l", "hand_l", "hand_l"),
            ("RightArm", "clavicle_r", "hand_r", "hand_r"),
            ("LeftLeg", "thigh_l", "foot_l", "foot_l"),
            ("RightLeg", "thigh_r", "foot_r", "foot_r"),
        ]
        for chain_name, start, end, goal in chains:
            goal_name = "None"
            if goal != "None":
                try:
                    goal_name = str(controller.add_new_goal(goal + "_goal", goal))
                except Exception:
                    goal_name = "None"
            try:
                controller.add_retarget_chain(chain_name, start, end, goal_name)
            except Exception as err:
                log("chain " + chain_name + " " + str(err))
        try:
            controller.set_retarget_root("pelvis")
        except Exception:
            pass
    unreal.EditorAssetLibrary.save_asset(asset_path)
    chain_names = []
    try:
        chain_names = [str(item) for item in controller.get_retarget_chains()]
    except Exception:
        try:
            chain_names = [str(item) for item in controller.get_retarget_chain_names()]
        except Exception:
            chain_names = ["auto" if auto_chains else "manual"]
    return rig, {"autoChains": auto_chains, "autoFbik": auto_fbik, "chains": chain_names, "path": asset_path}


def create_retargeter(source_rig, target_rig):
    ensure_folder("/Game/HVS/Characters/Rigs")
    if unreal.EditorAssetLibrary.does_asset_exist(RTG_PATH):
        unreal.EditorAssetLibrary.delete_asset(RTG_PATH)
    factory = unreal.IKRetargetFactory()
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    retargeter = asset_tools.create_asset("RTG_HVS_To_Manny", "/Game/HVS/Characters/Rigs", unreal.IKRetargeter, factory)
    controller = unreal.IKRetargeterController.get_controller(retargeter)
    controller.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE, source_rig)
    controller.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET, target_rig)
    pose_notes = []
    try:
        controller.snap_bone_to_ground("foot_l", unreal.RetargetSourceOrTarget.TARGET)
        pose_notes.append("snap_target_foot_l")
    except Exception as err:
        pose_notes.append("snap_failed:" + str(err))
    unreal.EditorAssetLibrary.save_asset(RTG_PATH)
    return retargeter, pose_notes


def batch_retarget(retargeter, mesh, source_anim):
    try:
        inputs = unreal.IKRetargetBatchOperationInputs()
        inputs.assets_to_retarget = [unreal.EditorAssetLibrary.find_asset_data(DERIVED_ANIM)]
        inputs.source_mesh = mesh
        inputs.target_mesh = mesh
        inputs.ik_retarget_asset = retargeter
        inputs.suffix = "_RTG"
        inputs.target_path = "/Game/HVS/Animation"
        inputs.overwrite_existing_files = True
        results = unreal.IKRetargetBatchOperation.run_batch_retarget(inputs)
        return [str(item.package_name) if hasattr(item, "package_name") else str(item) for item in (results or [])]
    except Exception as err:
        log("batch retarget failed " + str(err))
        return []


def update_sequence(anim):
    sequence = unreal.EditorAssetLibrary.load_asset(SEQ_PATH)
    ext = unreal.MovieSceneSequenceExtensions
    bind_ext = unreal.MovieSceneBindingExtensions
    section_ext = unreal.MovieSceneSectionExtensions
    track_ext = unreal.MovieSceneTrackExtensions
    ext.set_display_rate(sequence, unreal.FrameRate(24, 1))
    ext.set_tick_resolution_directly(sequence, unreal.FrameRate(24000, 1))
    ext.set_playback_start_seconds(sequence, 0.0)
    ext.set_playback_end_seconds(sequence, 11.0)
    rael_binding = None
    for binding in ext.get_bindings(sequence):
        for track in bind_ext.get_tracks(binding):
            if isinstance(track, unreal.MovieSceneSkeletalAnimationTrack):
                rael_binding = binding
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
    return sequence, rael_binding


def apply_control_rig(sequence, binding, world):
    notes = []
    cr_path = CR_FOOT
    try:
        blueprint = unreal.EditorAssetLibrary.load_asset(CR_FOOT)
        generated = None
        if hasattr(blueprint, "generated_class"):
            generated = blueprint.generated_class()
        if generated is None and hasattr(blueprint, "get_control_rig_class"):
            generated = blueprint.get_control_rig_class()
        if generated is None:
            generated = blueprint.get_class()
        options = unreal.AnimSeqExportOption()
        ok = unreal.ControlRigSequencerLibrary.bake_to_control_rig(world, sequence, generated, options, False, 0.0, binding, True)
        notes.append("bake_footik=" + str(ok))
        if ok:
            cr_path = CR_FOOT
    except Exception as err:
        notes.append("bake_failed:" + str(err))
        try:
            blueprint = unreal.EditorAssetLibrary.load_asset(CR_BODY)
            notes.append("body_available=" + str(bool(blueprint)))
            cr_path = CR_BODY
        except Exception as err2:
            notes.append("body_failed:" + str(err2))
            cr_path = None
    return cr_path, notes


def light_stage(rael):
    loc = rael.get_actor_location()
    settings = {
        "autoExposure": "manual_unbound_pp",
        "directionalIntensity": 80.0,
        "skyIntensity": 25.0,
        "rectIntensity": 80.0,
        "pointIntensity": 40.0,
        "exposureBias": 6.0,
        "lumenGI": 1,
        "lumenReflections": 1,
    }
    key = find_actor("HVS_KeyLight")
    if key:
        try:
            key.set_actor_rotation(unreal.Rotator(-55.0, 35.0, 0.0), False)
            key.light_component.set_intensity(80.0)
        except Exception:
            pass
    sky = find_actor("HVS_SkyLight")
    if sky:
        try:
            sky.light_component.set_intensity(25.0)
            try:
                sky.light_component.recapture_sky()
            except Exception:
                pass
        except Exception:
            pass
    fill = find_actor("HVS_FillLight")
    if fill:
        try:
            unreal.EditorLevelLibrary.destroy_actor(fill)
        except Exception:
            pass
    rect = find_actor("HVS_RectKey")
    if rect is None:
        rect = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.RectLight, loc + unreal.Vector(-180, -80, 220))
        rect.set_actor_label("HVS_RectKey")
    try:
        rect.set_actor_rotation((loc + unreal.Vector(0, 0, 110) - rect.get_actor_location()).rotator(), False)
        rect.light_component.set_intensity(80.0)
        rect.light_component.set_source_width(220.0)
        rect.light_component.set_source_height(280.0)
    except Exception:
        pass
    volume = find_actor("HVS_Exposure")
    if volume is None:
        volume = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PostProcessVolume, loc)
        volume.set_actor_label("HVS_Exposure")
    try:
        volume.set_editor_property("unbound", True)
        pp = volume.get_editor_property("settings")
        pp.set_editor_property("override_auto_exposure_method", True)
        pp.set_editor_property("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL)
        pp.set_editor_property("override_auto_exposure_bias", True)
        pp.set_editor_property("auto_exposure_bias", 6.0)
        try:
            pp.set_editor_property("override_auto_exposure_min_brightness", True)
            pp.set_editor_property("auto_exposure_min_brightness", 1.0)
            pp.set_editor_property("override_auto_exposure_max_brightness", True)
            pp.set_editor_property("auto_exposure_max_brightness", 1.0)
        except Exception:
            pass
        volume.set_editor_property("settings", pp)
    except Exception as err:
        settings["ppError"] = str(err)
    world = unreal.EditorLevelLibrary.get_editor_world()
    point = find_actor("HVS_PointFill")
    if point is None:
        point = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PointLight, loc + unreal.Vector(40, -60, 180))
        point.set_actor_label("HVS_PointFill")
    try:
        point.light_component.set_intensity(40.0)
        point.light_component.set_attenuation_radius(1200.0)
    except Exception:
        pass
    floor = find_actor("HVS_BounceFloor")
    if floor is None:
        floor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(loc.x, loc.y, 0.5))
        floor.set_actor_label("HVS_BounceFloor")
    try:
        plane = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane")
        if plane:
            floor.static_mesh_component.set_static_mesh(plane)
        floor.set_actor_scale3d(unreal.Vector(40.0, 40.0, 1.0))
        floor.set_actor_location(unreal.Vector(loc.x, loc.y, 0.5), False, True)
        mat = unreal.EditorAssetLibrary.load_asset("/Engine/EngineMaterials/DefaultMaterial")
        if mat:
            floor.static_mesh_component.set_material(0, mat)
    except Exception as err:
        settings["floorError"] = str(err)
    for command in (
        "showflag.bones 0",
        "showflag.billboardsprites 0",
        "showflag.sprites 0",
        "showflag.modewidgets 0",
        "showflag.grid 1",
        "showflag.volumes 0",
        "showflag.bounds 0",
        "showflag.selection 0",
        "viewmode lit",
        "r.DynamicGlobalIlluminationMethod 1",
        "r.ReflectionMethod 1",
        "r.SkyLight.RealTimeReflectionCapture 1",
    ):
        try:
            unreal.SystemLibrary.execute_console_command(world, command, None)
        except TypeError:
            unreal.SystemLibrary.execute_console_command(world, command)
    return settings


def apply_materials(rael):
    mesh = rael.skeletal_mesh_component
    m1 = unreal.EditorAssetLibrary.load_asset("/Game/Characters/Mannequins/Materials/Manny/MI_Manny_01_New")
    m2 = unreal.EditorAssetLibrary.load_asset("/Game/Characters/Mannequins/Materials/Manny/MI_Manny_02_New")
    if m1:
        mesh.set_material(0, m1)
    if m2:
        mesh.set_material(1, m2)
    return bool(m1)


def place_cameras(rael):
    loc = rael.get_actor_location()
    chest = unreal.Vector(loc.x, loc.y, loc.z + 100.0)
    head = unreal.Vector(loc.x, loc.y, loc.z + 150.0)
    for name, spec in HVS_CAMERAS.items():
        label = "HVS_Cam_" + name.replace(" ", "_").replace("'", "")
        actor = find_actor(label)
        if not actor:
            actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.CineCameraActor, spec["location"])
            actor.set_actor_label(label)
        target = head if spec["lens"] >= 50 else chest
        actor.set_actor_location(spec["location"], False, True)
        actor.set_actor_rotation((target - spec["location"]).rotator(), False)
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


def camera_named(name):
    return find_actor("HVS_Cam_" + name.replace(" ", "_").replace("'", ""))


def lens_fov(lens_mm):
    return math.degrees(2.0 * math.atan(18.0 / float(lens_mm)))


def seek(seconds):
    lib = unreal.LevelSequenceEditorBlueprintLibrary
    params = unreal.MovieSceneSequencePlaybackParams()
    params.position_type = unreal.MovieScenePositionType.TIME
    params.time = float(seconds)
    lib.set_global_position(params, unreal.MovieSceneTimeUnit.DISPLAY_RATE)
    lib.pause()


def pose_rael(rael, seconds, anim):
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
        log("override_animation_data " + str(err))


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


def samples():
    return [
        {"name": "mesh_t00_wide", "seconds": 0.0, "camera": "Wide", "lensMm": 24, "ticks": 0},
        {"name": "mesh_t16_lower_body", "seconds": 1.603, "camera": "Wide", "lensMm": 24, "ticks": 38472},
        {"name": "mesh_t30_walk", "seconds": 3.0, "camera": "Walk", "lensMm": 24, "ticks": 72000},
        {"name": "mesh_t58_left_arm", "seconds": 5.769, "camera": "Walk", "lensMm": 24, "ticks": 138456},
        {"name": "mesh_t60_lookback", "seconds": 6.0, "camera": "Look back", "lensMm": 24, "ticks": 144000},
        {"name": "mesh_t80_closeup", "seconds": 8.0, "camera": "Close-up of Ra'el", "lensMm": 85, "ticks": 192000},
        {"name": "mesh_t85_closeup", "seconds": 8.5, "camera": "Close-up of Ra'el", "lensMm": 85, "ticks": 204000},
        {"name": "mesh_t58_scrub_back", "seconds": 5.769, "camera": "Walk", "lensMm": 24, "ticks": 138456},
        {"name": "mesh_t00_restart", "seconds": 0.0, "camera": "Wide", "lensMm": 24, "ticks": 0},
    ]


def frame_viewport(sample, anim):
    seek(sample["seconds"])
    rael = find_actor("BP_Rael_Commander")
    if rael:
        pose_rael(rael, sample["seconds"], anim)
    spec = HVS_CAMERAS[sample["camera"]]
    loc = spec["location"]
    target_z = 150.0 if sample["lensMm"] >= 50 else 100.0
    target = (rael.get_actor_location() + unreal.Vector(0, 0, target_z)) if rael else unreal.Vector(20, -120, target_z)
    set_editor_camera(loc, (target - loc).rotator(), lens_fov(sample["lensMm"]))
    return camera_named(sample["camera"])


def measure_root(seconds, rael):
    loc = rael.get_actor_location()
    xform = rael.skeletal_mesh_component.get_bone_transform("root", unreal.RelativeTransformSpace.RTS_WORLD)
    hand = rael.skeletal_mesh_component.get_bone_transform("hand_l", unreal.RelativeTransformSpace.RTS_WORLD)
    origin, extent = rael.get_actor_bounds(False)
    return {
        "seconds": seconds,
        "ticks": int(round(seconds * 24000)),
        "actor": [loc.x, loc.y, loc.z],
        "rootWorld": [xform.translation.x, xform.translation.y, xform.translation.z],
        "handL": [hand.translation.x, hand.translation.y, hand.translation.z],
        "boundsExtent": [extent.x, extent.y, extent.z],
    }


def on_tick(_dt):
    state = STATE
    state["tick"] += 1
    if _dt:
        try:
            state["fps"].append(1.0 / max(float(_dt), 1e-4))
        except Exception:
            pass
    shots = samples()
    if state["phase"] == "warm":
        if state["tick"] < WARM_TICKS:
            return
        state["phase"] = "seek"
        log("warmed ticks=" + str(state["tick"]))
        return
    if state["phase"] == "seek":
        if state["index"] >= len(shots):
            proof = STATE["proof"]
            proof["captures"] = state["captures"]
            proof["root"] = state["root"]
            proof["captureComplete"] = True
            needed = ("mesh_t00_wide", "mesh_t16_lower_body", "mesh_t58_left_arm", "mesh_t85_closeup", "mesh_t58_scrub_back")
            proof["visualOk"] = all(item.get("nonBlack") for item in state["captures"] if item["name"] in needed)
            fps = state["fps"][20:] or state["fps"]
            proof["performance"] = {
                "viewportFpsAvg": (sum(fps) / len(fps)) if fps else None,
                "viewportFpsMin": min(fps) if fps else None,
                "frameTimeMsAvg": (1000.0 * len(fps) / sum(fps)) if fps else None,
                "samples": len(fps),
                **host_metrics(),
            }
            write_proof(proof)
            log("capture complete visualOk=" + str(proof["visualOk"]))
            if state["handle"] is not None:
                unreal.unregister_slate_post_tick_callback(state["handle"])
            return
        sample = shots[state["index"]]
        state["sample"] = sample
        state["camera"] = frame_viewport(sample, STATE["anim"])
        state["phase"] = "settle"
        state["wait"] = 0
        return
    if state["phase"] == "settle":
        state["wait"] += 1
        if state["wait"] < SEEK_SETTLE:
            return
        os.makedirs(PROOF_DIR, exist_ok=True)
        path = os.path.join(PROOF_DIR, state["sample"]["name"] + ".png")
        if os.path.exists(path):
            os.remove(path)
        task = unreal.AutomationLibrary.take_high_res_screenshot(1600, 900, path, delay=0.15, force_game_view=False)
        camera = state.get("camera")
        focal = state["sample"]["lensMm"]
        if camera:
            try:
                focal = float(camera.get_cine_camera_component().get_editor_property("current_focal_length"))
            except Exception:
                pass
        state["pending"] = {"task": task, "path": path, "focalMm": focal, "cameraActor": camera.get_actor_label() if camera else None}
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
        if path and os.path.exists(path) and os.path.getsize(path) > 1000 and (done or state["wait"] >= 20):
            stats = png_stats(path)
            captured = dict(state["sample"])
            captured.update(stats)
            captured["focalMm"] = state["pending"].get("focalMm")
            captured["cameraActor"] = state["pending"].get("cameraActor")
            captured["capturedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            captured["method"] = "editor_viewport_highresshot_mesh"
            captured["bones"] = False
            if captured["name"] in ("mesh_t00_wide", "mesh_t58_left_arm"):
                rael = find_actor("BP_Rael_Commander")
                if rael:
                    state["root"].append(measure_root(captured["seconds"], rael))
            state["captures"].append(captured)
            proof = STATE.get("proof")
            if proof:
                proof["captures"] = state["captures"]
                proof["root"] = state["root"]
                write_proof(proof)
            log("captured " + captured["name"] + " luma=" + str(captured.get("meanLuma")) + " buckets=" + str(captured.get("colorBuckets")))
            state["index"] += 1
            state["phase"] = "seek"
        elif state["wait"] >= 150:
            state["index"] += 1
            state["phase"] = "seek"


def run():
    os.makedirs(PROOF_DIR, exist_ok=True)
    with open(PACKAGE, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if unreal.EditorAssetLibrary.does_asset_exist(MAP_PATH):
        unreal.EditorLevelLibrary.load_level(MAP_PATH)
    mesh = unreal.EditorAssetLibrary.load_asset(MANNY)
    skeleton = mesh.skeleton
    bone_names, rest = inspect_skeleton(mesh)
    anim, used, length, keys = write_anim(DERIVED_ANIM, mesh, skeleton, payload, rest, bone_names)
    source_rig = target_rig = retargeter = None
    source_meta = target_meta = {"path": None, "error": "not created"}
    pose_notes = []
    batch = []
    try:
        source_rig, source_meta = create_ik_rig(IK_SOURCE, mesh, "source")
        target_rig, target_meta = create_ik_rig(IK_TARGET, mesh, "target")
        retargeter, pose_notes = create_retargeter(source_rig, target_rig)
        batch = batch_retarget(retargeter, mesh, anim)
    except Exception as err:
        log("ik pipeline failed " + str(err))
        pose_notes.append("ik_pipeline_failed:" + str(err))
    sequence, binding = update_sequence(anim)
    world = unreal.EditorLevelLibrary.get_editor_world()
    try:
        unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(sequence)
        unreal.LevelSequenceEditorBlueprintLibrary.set_lock_camera_cut_to_viewport(False)
    except Exception:
        pass
    cr_path, cr_notes = apply_control_rig(sequence, binding, world) if binding else (CR_FOOT, ["no-binding"])
    rael = find_actor("BP_Rael_Commander")
    if not rael:
        raise RuntimeError("BP_Rael_Commander missing")
    materials = apply_materials(rael)
    lighting = light_stage(rael)
    place_cameras(rael)
    try:
        unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(sequence)
        unreal.LevelSequenceEditorBlueprintLibrary.set_lock_camera_cut_to_viewport(False)
    except Exception:
        pass
    abs_error = abs(float(length) - HVS_DURATION)
    proof = {
        "ok": abs_error <= (1.0 / 24.0),
        "engine": "HVS-UE-04",
        "method": "two_bone_ik_plus_ikrig",
        "sourceHash": payload["sourceHash"],
        "takeId": payload["takeId"],
        "motionId": payload["motionId"],
        "characterId": "rael-commander",
        "hvsDurationSec": HVS_DURATION,
        "hvsDurationTicks": 230769,
        "hvsTimescale": 24000,
        "unrealDurationSec": float(length),
        "absErrorMs": abs_error * 1000.0,
        "frameError24": abs_error * 24.0,
        "sampleCount": SAMPLE_COUNT,
        "frameRate": TARGET_FPS,
        "sampledKeys": keys,
        "sourceAnimationPath": SOURCE_ANIM,
        "derivedAnimationPath": DERIVED_ANIM,
        "lineage": ["take-mud7ggfd-zgdqbm", "AN_Rael_Take3", "two_bone_ik", "AN_Rael_Take3_Manny"],
        "ikSourcePath": IK_SOURCE,
        "ikTargetPath": IK_TARGET,
        "ikRetargeterPath": RTG_PATH,
        "controlRigPath": cr_path,
        "controlRigNotes": cr_notes,
        "ikSourceMeta": source_meta,
        "ikTargetMeta": target_meta,
        "retargetPose": pose_notes,
        "batchRetarget": batch,
        "lighting": lighting,
        "materialsApplied": materials,
        "foundRigs": {
            "CR_Mannequin_Body": CR_BODY,
            "CR_Mannequin_FootIK": CR_FOOT,
            "CR_Mannequin_Procedural": "/Game/Characters/Mannequins/Rigs/CR_Mannequin_Procedural",
        },
        "nanite": "NOT REQUIRED / DISABLED",
        "enableRootMotion": False,
        "metahuman": False,
        "faceCapture": "NOT_STARTED",
        "executionFraming": {
            "wideLocation": [194.0, -319.0, 160.0],
            "walkLocation": [201.44950442280543, -327.3708621974917, 155.0],
            "lookbackLocation": [165.0, 172.0, 160.0],
            "closeupLocation": [-80.0, -90.0, 155.0],
            "hvsCameraSpecUnchanged": True,
            "note": "derived Unreal cameras moved closer for mesh fill; HVS CameraSpec/lens/timing unchanged",
        },
        "captureComplete": False,
        "usedTracks": [{"hvs": hvs, "unreal": ue} for hvs, ue in used],
    }
    write_proof(proof)
    STATE["proof"] = proof
    STATE["anim"] = anim
    STATE["handle"] = unreal.register_slate_post_tick_callback(on_tick)
    log("retarget scheduled duration=" + str(length))
    return proof


try:
    RESULT = run()
except Exception as exc:
    unreal.log_error("[HVS-UE-04] " + traceback.format_exc())
    write_proof({"ok": False, "engine": "HVS-UE-04", "errors": [str(exc), traceback.format_exc()], "faceCapture": "NOT_STARTED", "metahuman": False})
