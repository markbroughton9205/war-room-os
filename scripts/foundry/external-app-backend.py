#!/usr/bin/env python3
"""Foundry External App backend — AT-SPI + GNOME screenshot + AT-SPI key synth.

Separate from computer-use-backend.py. Does not walk War Room as default.
Never prints passwords, tokens, or clipboard history.
Invoked as: python3 external-app-backend.py <command> [json]
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time

# Do NOT force GDK_BACKEND=x11. Cursor is Wayland.


def out(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def fail(error: str, **extra) -> dict:
    payload = {"ok": False, "error": error, **extra}
    out(payload)
    return payload


def _atspi():
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
    return Atspi


def _find_app(needle: str):
    Atspi = _atspi()
    desktop = Atspi.get_desktop(0)
    count = int(desktop.get_child_count() or 0)
    wanted = (needle or "").strip().lower()
    for i in range(min(count, 64)):
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        name = str(app.get_name() or "")
        if wanted and wanted not in name.lower():
            continue
        return app, name
    return None, None


def _frame_payload(app, name: str) -> dict:
    child_count = int(app.get_child_count() or 0)
    frame = app.get_child_at_index(0) if child_count else None
    title = str(frame.get_name() or "") if frame is not None else ""
    role = str(frame.get_role_name() or "") if frame is not None else ""
    screen = frame.get_extents(0) if frame is not None and hasattr(frame, "get_extents") else None
    n_actions = 0
    actions = []
    try:
        n_actions = int(frame.get_n_actions() or 0) if frame is not None else 0
        for a in range(n_actions):
            actions.append(str(frame.get_action_name(a) or ""))
    except Exception:
        pass
    nodes = 1 + (1 if frame is not None else 0)
    named = [{"name": name, "role": "application"}]
    if title:
        named.append({"name": title, "role": role or "frame"})
    return {
        "ok": True,
        "app": name,
        "title": title[:200],
        "role": role,
        "childCount": child_count,
        "nodesVisited": nodes,
        "namedControls": named,
        "actions": actions,
        "screen": None
        if screen is None
        else {
            "x": getattr(screen, "x", None),
            "y": getattr(screen, "y", None),
            "width": getattr(screen, "width", None),
            "height": getattr(screen, "height", None),
        },
        "electronChildrenExposed": nodes > 2,
        "backend": "accessibility",
    }


def discover_app(app_filter: str) -> dict:
    app, name = _find_app(app_filter)
    if app is None:
        return {"ok": False, "error": f"AT-SPI application {app_filter!r} not found"}
    return _frame_payload(app, name or app_filter)


def dump_tree(app_filter: str, budget_s: float = 2.0, max_nodes: int = 400) -> dict:
    from collections import deque
    app, name = _find_app(app_filter)
    if app is None:
        return {"ok": False, "error": f"AT-SPI application {app_filter!r} not found"}
    deadline = time.monotonic() + budget_s
    queue = deque([(app, 0)])
    named = []
    roles = {}
    seen = 0
    while queue and seen < max_nodes and time.monotonic() < deadline:
        node, depth = queue.popleft()
        seen += 1
        try:
            n = str(node.get_name() or "").strip()
        except Exception:
            n = ""
        try:
            role = str(node.get_role_name() or "")
        except Exception:
            role = ""
        roles[role] = roles.get(role, 0) + 1
        if n:
            named.append({"name": n[:180], "role": role, "depth": depth})
        if depth >= 12:
            continue
        try:
            count = int(node.get_child_count() or 0)
        except Exception:
            count = 0
        for j in range(min(count, 40)):
            try:
                child = node.get_child_at_index(j)
            except Exception:
                child = None
            if child is not None:
                queue.append((child, depth + 1))
    return {
        "ok": True,
        "app": name,
        "nodesVisited": seen,
        "namedCount": len(named),
        "roles": roles,
        "names": named[:80],
        "electronChildrenExposed": seen > 2,
        "backend": "accessibility",
    }


def focus_app(app_filter: str) -> dict:
    app, name = _find_app(app_filter)
    if app is None:
        return {"ok": False, "error": f"AT-SPI application {app_filter!r} not found"}
    payload = _frame_payload(app, name or app_filter)
    frame = app.get_child_at_index(0) if int(app.get_child_count() or 0) else None
    grabbed = False
    activated = False
    if frame is not None:
        try:
            grabbed = bool(frame.grab_focus())
        except Exception as exc:
            payload["grabError"] = str(exc)
        try:
            if hasattr(frame, "do_action") and int(frame.get_n_actions() or 0) > 0:
                activated = bool(frame.do_action(0))
        except Exception as exc:
            payload["activateError"] = str(exc)
        try:
            states = [s.value_nick for s in frame.get_state_set().get_states()]
        except Exception:
            states = []
        payload["states"] = states
        payload["active"] = "active" in states or "focused" in states
    payload["grab_focus"] = grabbed
    payload["doDefault"] = activated
    payload["ok"] = True
    payload["focused"] = bool(payload.get("active") or grabbed or activated)
    payload["backend"] = "wayland-atspi-focus"
    return payload


def gnome_screenshot(path: str) -> dict:
    attempts = []
    abs_path = os.path.abspath(path)
    os.makedirs(os.path.dirname(abs_path) or ".", exist_ok=True)
    try:
        proc = subprocess.run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.gnome.Shell.Screenshot",
                "--object-path",
                "/org/gnome/Shell/Screenshot",
                "--method",
                "org.gnome.Shell.Screenshot.Screenshot",
                "false",
                "false",
                abs_path,
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        attempts.append(proc.stdout.strip() or proc.stderr.strip())
        if proc.returncode == 0 and os.path.isfile(abs_path) and os.path.getsize(abs_path) > 32:
            digest = hashlib.sha256(open(abs_path, "rb").read()).hexdigest()
            return {
                "ok": True,
                "path": abs_path,
                "backend": "gnome-shell-screenshot",
                "sha256": digest,
                "bytes": os.path.getsize(abs_path),
                "attempts": attempts,
            }
    except Exception as exc:
        attempts.append(f"gdbus: {exc}")
    try:
        from PIL import ImageGrab
        img = ImageGrab.grab()
        img.save(abs_path)
        digest = hashlib.sha256(open(abs_path, "rb").read()).hexdigest()
        return {
            "ok": True,
            "path": abs_path,
            "backend": "pil-imagegrab",
            "sha256": digest,
            "bytes": os.path.getsize(abs_path),
            "attempts": attempts,
        }
    except Exception as exc:
        attempts.append(f"PIL: {exc}")
    return {
        "ok": False,
        "error": "SCREENSHOT_COMPOSITOR",
        "attempts": attempts,
        "backend": "wayland-portal",
        "attention": "COMMANDER_ATTENTION_REQUIRED",
        "whatFoundryNeeds": "Grant GNOME screenshot permission or install grim; do not disable Wayland security.",
    }


def _crop_frame(img, frame: dict | None):
    if not frame or not all(isinstance(frame.get(k), (int, float)) for k in ("x", "y", "width", "height")):
        return img, 1.0, {"x": 0, "y": 0, "width": img.width, "height": img.height}
    scale_x = img.width / max(1, int(frame.get("screenWidth") or img.width))
    scale_y = img.height / max(1, int(frame.get("screenHeight") or img.height))
    scale = scale_x if abs(scale_x - scale_y) < 0.15 else 1.0
    x = max(0, int(frame["x"] * scale))
    y = max(0, int(frame["y"] * scale))
    w = max(8, int(frame["width"] * scale))
    h = max(8, int(frame["height"] * scale))
    x2 = min(img.width, x + w)
    y2 = min(img.height, y + h)
    return img.crop((x, y, x2, y2)), scale, {"x": x, "y": y, "width": x2 - x, "height": y2 - y}


def vision_targets(path: str, frame: dict | None = None) -> dict:
    try:
        from PIL import Image
    except Exception as exc:
        return {"ok": False, "error": f"PIL unavailable: {exc}"}
    if not os.path.isfile(path):
        return {"ok": False, "error": "screenshot missing"}
    img = Image.open(path).convert("RGB")
    crop, scale, origin = _crop_frame(img, frame)
    gray = crop.convert("L")
    w, h = gray.size
    if w < 40 or h < 40:
        return {"ok": False, "error": "crop too small"}
    pix = gray.load()
    # Find a wide, relatively uniform band in the lower 45% (composer chrome).
    y0 = int(h * 0.55)
    row_var = []
    for y in range(y0, h):
        vals = [pix[x, y] for x in range(0, w, max(1, w // 80))]
        mean = sum(vals) / max(1, len(vals))
        var = sum((v - mean) ** 2 for v in vals) / max(1, len(vals))
        row_var.append((y, mean, var))
    # Prefer a mid-contrast row cluster (input well) near the bottom, not the very last 4px.
    candidates = [row for row in row_var if 80 < row[1] < 220 and row[2] < 1800]
    if not candidates:
        candidates = row_var[-max(8, h // 20) :]
    band_y = candidates[len(candidates) // 2][0] if candidates else int(h * 0.82)
    band_h = max(36, int(h * 0.12))
    top = max(y0, band_y - band_h // 2)
    bottom = min(h - 2, top + band_h)
    left = int(w * 0.08)
    right = int(w * 0.88)
    composer = {
        "role": "composer",
        "expectedRole": "text-input",
        "x": origin["x"] + left,
        "y": origin["y"] + top,
        "width": max(24, right - left),
        "height": max(24, bottom - top),
    }
    send = {
        "role": "submit",
        "expectedRole": "button",
        "x": origin["x"] + int(w * 0.90),
        "y": origin["y"] + top + max(4, (bottom - top) // 3),
        "width": max(20, int(w * 0.06)),
        "height": max(20, int((bottom - top) * 0.5)),
    }
    response = {
        "role": "response",
        "expectedRole": "document",
        "x": origin["x"] + int(w * 0.22),
        "y": origin["y"] + int(h * 0.12),
        "width": int(w * 0.72),
        "height": int(h * 0.42),
    }
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    return {
        "ok": True,
        "backend": "vision",
        "scale": scale,
        "frameGeneration": digest[:16],
        "screenshotSha256": digest,
        "crop": origin,
        "targets": [composer, send, response],
        "note": "Bounded lower-band composer estimate from observed screenshot. Not a stored absolute click map.",
    }


def region_hash(path: str, rect: dict) -> dict:
    try:
        from PIL import Image
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    img = Image.open(path).convert("RGB")
    x, y, w, h = (int(rect.get(k) or 0) for k in ("x", "y", "width", "height"))
    box = (max(0, x), max(0, y), min(img.width, x + max(1, w)), min(img.height, y + max(1, h)))
    crop = img.crop(box)
    raw = crop.tobytes()
    return {
        "ok": True,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "box": {"x": box[0], "y": box[1], "width": box[2] - box[0], "height": box[3] - box[1]},
        "mean": sum(raw[0::3]) / max(1, len(raw) // 3),
    }


def type_text(text: str) -> dict:
    if not text or len(text) > 4000:
        return {"ok": False, "error": "text empty or over bound"}
    Atspi = _atspi()
    try:
        ok = bool(Atspi.generate_keyboard_event(0, text, Atspi.KeySynthType.STRING))
        return {"ok": ok, "backend": "wayland-atspi-keysynth", "chars": len(text), "method": "STRING"}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "backend": "wayland-atspi-keysynth"}


def hotkey(keys: list[str]) -> dict:
    Atspi = _atspi()
    sent = []
    try:
        mods = [k.lower() for k in keys[:-1]]
        last = keys[-1] if keys else ""
        keysyms = {
            "ctrl": 0xFFE3,
            "control": 0xFFE3,
            "shift": 0xFFE1,
            "alt": 0xFFE9,
            "enter": 0xFF0D,
            "return": 0xFF0D,
            "l": 0x006C,
            "i": 0x0069,
            "a": 0x0061,
            "v": 0x0076,
            "n": 0x006E,
            "escape": 0xFF1B,
        }
        for mod in mods:
            Atspi.generate_keyboard_event(keysyms.get(mod, 0), None, Atspi.KeySynthType.PRESS)
            sent.append(f"down:{mod}")
        code = keysyms.get(last.lower(), ord(last[0]) if last else 0)
        Atspi.generate_keyboard_event(code, None, Atspi.KeySynthType.PRESSRELEASE)
        sent.append(f"tap:{last}")
        for mod in reversed(mods):
            Atspi.generate_keyboard_event(keysyms.get(mod, 0), None, Atspi.KeySynthType.RELEASE)
            sent.append(f"up:{mod}")
        return {"ok": True, "backend": "wayland-atspi-keysynth", "keys": keys, "sent": sent}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "backend": "wayland-atspi-keysynth", "sent": sent}


def portal_status() -> dict:
    names = []
    try:
        proc = subprocess.run(
            ["busctl", "--user", "list"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        for line in proc.stdout.splitlines():
            if "portal" in line.lower() or "RemoteDesktop" in line or "Mutter" in line:
                names.append(line.split()[0])
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "backend": "wayland-portal",
        "names": names[:24],
        "screenshotPortal": any("portal.Desktop" in n or n.endswith("portal.Desktop") for n in names)
        or "org.freedesktop.portal.Desktop" in names,
        "remoteDesktop": any("RemoteDesktop" in n for n in names),
        "note": "RemoteDesktop/portal input requires an interactive compositor session; never disable Wayland security.",
    }


def main() -> int:
    if len(sys.argv) < 2:
        fail("missing command")
        return 2
    command = sys.argv[1]
    payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    try:
        if command == "discover_app":
            out(discover_app(str(payload.get("app") or "cursor")))
        elif command == "dump_tree":
            out(dump_tree(str(payload.get("app") or "cursor")))
        elif command == "focus_app":
            out(focus_app(str(payload.get("app") or "cursor")))
        elif command == "screenshot":
            out(gnome_screenshot(str(payload.get("path") or "/tmp/foundry-ext-app.png")))
        elif command == "vision_targets":
            out(vision_targets(str(payload.get("path") or ""), payload.get("frame")))
        elif command == "region_hash":
            out(region_hash(str(payload.get("path") or ""), payload.get("rect") or {}))
        elif command == "type_text":
            out(type_text(str(payload.get("text") or "")))
        elif command == "hotkey":
            keys = payload.get("keys") or []
            if isinstance(keys, str):
                keys = keys.replace("+", "-").split("-")
            out(hotkey([str(k) for k in keys]))
        elif command == "portal_status":
            out(portal_status())
        else:
            fail("UNKNOWN_COMMAND", command=command)
            return 2
        return 0
    except Exception as exc:
        fail("BACKEND_EXCEPTION", detail=str(exc), command=command)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
