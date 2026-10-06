# HVS operator-step bridge. Loaded by Unreal as Content/Python/init_unreal.py.
# Starts the file-bridge poller only. Does not AutoRig, submit cloud, or quit the editor.
import json
import os
import sys

BRIDGE = "/home/chosenone/.local/share/war-room-os/data/media-command/unreal/hvs-mud545ez-8w3a/character-ops/hvs_python_bridge.json"


def _start():
    if not os.path.exists(BRIDGE):
        return
    try:
        with open(BRIDGE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return
    script = data.get("likenessOps")
    if not script or not os.path.exists(script):
        return
    folder = os.path.dirname(script)
    if folder not in sys.path:
        sys.path.insert(0, folder)
    try:
        import hvs_likeness_ops
    except Exception:
        return
    if hasattr(hvs_likeness_ops, "start_operator_step_poller"):
        hvs_likeness_ops.start_operator_step_poller()


_start()
