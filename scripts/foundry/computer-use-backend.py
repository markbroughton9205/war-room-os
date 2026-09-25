#!/usr/bin/env python3
"""Foundry Computer Use backend: AT-SPI + GTK clipboard + Gdk screenshot.

Invoked as: python3 computer-use-backend.py <command> [json]
Prints a single JSON object to stdout. Never prints cookies/passwords.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time

os.environ.setdefault("GDK_BACKEND", "x11")

CACHE_PATH = os.path.join(os.environ.get("TMPDIR") or "/tmp", "foundry-cu-war-room-root.json")


def out(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def fail(status: str, blocker: str, evidence: str, attempts: list[str], why: str, next_action: str) -> None:
    out({
        "ok": False,
        "status": status,
        "blocker": blocker,
        "evidence": evidence,
        "attempts": attempts,
        "whyCurrentEnvironmentPreventsIt": why,
        "exactNextAction": next_action,
    })


def screens() -> dict:
    import gi
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk
    display = Gdk.Display.get_default()
    if display is None:
        return {"ok": False, "error": "No Gdk display."}
    monitors = []
    for i in range(display.get_n_monitors()):
        m = display.get_monitor(i)
        g = m.get_geometry()
        monitors.append({"index": i, "x": g.x, "y": g.y, "width": g.width, "height": g.height, "scale": m.get_scale_factor()})
    return {"ok": True, "backend": "gdk", "sessionType": os.environ.get("XDG_SESSION_TYPE"), "display": display.get_name(), "screens": monitors}


def clipboard_read() -> dict:
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gtk, Gdk
    clip = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    text = clip.wait_for_text()
    return {"ok": True, "text": text or "", "chars": len(text or "")}


def clipboard_write(text: str) -> dict:
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gtk, Gdk
    clip = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    clip.set_text(text, -1)
    clip.store()
    while Gtk.events_pending():
        Gtk.main_iteration()
    readback = clip.wait_for_text() or ""
    if readback == text:
        return {"ok": True, "chars": len(text), "roundtrip": True, "readbackChars": len(readback)}
    return {
        "ok": False,
        "status": "BLOCKED",
        "blocker": "WAYLAND_COMPOSITOR_CLIPBOARD",
        "evidence": {"wroteChars": len(text), "readbackChars": len(readback), "readbackPrefix": readback[:80]},
        "attempts": ["Gtk.Clipboard X11 GDK_BACKEND=x11 set_text+store+wait_for_text"],
        "whyCurrentEnvironmentPreventsIt": "This session is Wayland. GTK clipboard writes from an X11 backend do not become the compositor clipboard, and wl-clipboard/xclip are not installed.",
        "exactNextAction": "Install wl-clipboard and retry computer.clipboard_write/read against the Wayland clipboard.",
    }


def screenshot(path: str, xid: int | None) -> dict:
    attempts = []
    try:
        from PIL import ImageGrab
        if xid is None:
            img = ImageGrab.grab()
            img.save(path)
            attempts.append("PIL.ImageGrab.grab")
            return {"ok": True, "path": path, "backend": "pil-imagegrab", "attempts": attempts}
    except Exception as e:
        attempts.append(f"PIL.ImageGrab failed: {e}")
    try:
        import gi
        gi.require_version("Gdk", "3.0")
        from gi.repository import Gdk
        display = Gdk.Display.get_default()
        window = display.get_default_screen().get_root_window() if display else None
        if window is not None:
            from gi.repository import Gdk as Gdk2
            w = window.get_width()
            h = window.get_height()
            pixbuf = Gdk2.pixbuf_get_from_window(window, 0, 0, w, h)
            if pixbuf is not None:
                pixbuf.savev(path, "png", [], [])
                attempts.append("Gdk.pixbuf_get_from_window")
                return {"ok": True, "path": path, "backend": "gdk", "attempts": attempts}
            attempts.append("Gdk.pixbuf_get_from_window returned None (typical on pure Wayland)")
        else:
            attempts.append("no Gdk root window")
    except Exception as e:
        attempts.append(f"Gdk screenshot failed: {e}")
    fail(
        "BLOCKED",
        "SCREENSHOT_COMPOSITOR",
        json.dumps(attempts),
        attempts,
        "This session is Wayland (wayland-0). Gdk/PIL cannot capture the compositor buffer without xdg-desktop-portal interactive permission, and ImageMagick is not installed.",
        "Install grim (wlroots) or grant portal screenshot permission for the Foundry helper, then retry computer.screenshot.",
    )
    return {}


def _role_ok(role_name: str, role: str | None) -> bool:
    if not role:
        return True
    wanted = role.lower().replace("push ", "")
    have = str(role_name).lower().replace("push ", "")
    return wanted in have or have in wanted


def _inspect_node(node, needle: str, role: str | None, name_only: bool, timed: bool = True) -> dict | None:
    try:
        if timed:
            name = _accessible_name(node) or ""
            role_name = str(_call_timeout(lambda: node.get_role_name() if hasattr(node, "get_role_name") else "", 0.12, "") or "")
        else:
            name = node.get_name() or ""
            role_name = node.get_role_name() if hasattr(node, "get_role_name") else ""
        needle_l = (needle or "").strip().lower()
        name_l = name.lower().strip()
        exact = bool(needle_l) and name_l == needle_l
        name_hit = bool(needle_l) and needle_l in name_l
        visible = name
        text_hit = False
        if not name_only and not exact and not name_hit:
            try:
                desc = node.get_description() if hasattr(node, "get_description") else ""
                if desc:
                    visible = f"{visible} {desc}".strip()
            except Exception:
                pass
            try:
                if hasattr(node, "get_text"):
                    extra = node.get_text(0, 240) or ""
                    if extra:
                        visible = f"{visible} {extra}".strip()
            except Exception:
                pass
            text_hit = bool(needle_l) and needle_l in visible.lower()
        if not (exact or name_hit or text_hit):
            return None
        if not _role_ok(str(role_name), role):
            return None
        if timed:
            ext = _call_timeout(lambda: node.get_extents(0) if hasattr(node, "get_extents") else None, 0.12, None)
        else:
            ext = node.get_extents(0) if hasattr(node, "get_extents") else None
        x = getattr(ext, "x", None)
        y = getattr(ext, "y", None)
        width = getattr(ext, "width", None)
        height = getattr(ext, "height", None)
        if exact:
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                return None
            width = width if isinstance(width, (int, float)) and width > 0 else 1
            height = height if isinstance(height, (int, float)) and height > 0 else 1
        else:
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or abs(x) >= 100_000 or abs(y) >= 100_000:
                return None
            if isinstance(width, (int, float)) and width <= 0:
                return None
            if isinstance(height, (int, float)) and height <= 0:
                return None
        score = 10
        if exact:
            score += 100
        elif name_l.startswith(needle_l):
            score += 60
        elif name_hit:
            score += 40
        if role and role.lower() in str(role_name).lower():
            score += 20
        elif "button" in str(role_name).lower() or "link" in str(role_name).lower():
            score += 15
        return {
            "name": name[:200] or visible[:200],
            "role": str(role_name),
            "text": visible[:240],
            "strategy": "accessible-name" if (exact or name_hit) else "visible-text",
            "score": score,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "exact": exact,
        }
    except Exception:
        return None


def _walk_atspi(root, needle: str, hits: list, role: str | None = None, name_only: bool = True, budget_s: float = 2.4, timed: bool = True) -> None:
    import time
    from collections import deque
    deadline = time.monotonic() + budget_s
    queue = deque([(root, 0)])
    seen = 0
    wanted_role = (role or "").lower().replace("push ", "")
    while queue and len(hits) < 12 and seen < 1200 and time.monotonic() < deadline:
        node, depth = queue.popleft()
        seen += 1
        role_name = ""
        try:
            if timed:
                role_name = str(_call_timeout(lambda: node.get_role_name() if hasattr(node, "get_role_name") else "", 0.2, "") or "")
            else:
                role_name = str(node.get_role_name() if hasattr(node, "get_role_name") else "")
        except Exception:
            role_name = ""
        role_l = role_name.lower().replace("push ", "")
        skip_inspect = False
        if wanted_role:
            if not role_l:
                skip_inspect = True
            else:
                skip_inspect = wanted_role not in role_l and role_l not in wanted_role
        if not skip_inspect:
            hit = _inspect_node(node, needle, role, name_only, timed)
            if hit:
                hits.append(hit)
                if hit.get("exact") and int(hit.get("score") or 0) >= 110:
                    return
        if depth >= 22:
            continue
        try:
            count = int((_call_timeout(lambda: node.get_child_count(), 0.2, 0) if timed else node.get_child_count()) or 0)
        except Exception:
            continue
        for i in range(min(int(count or 0), 40)):
            if time.monotonic() >= deadline:
                break
            if timed:
                child = _call_timeout(lambda i=i: node.get_child_at_index(i), 0.2, None)
            else:
                try:
                    child = node.get_child_at_index(i)
                except Exception:
                    child = None
            if child is not None:
                queue.append((child, depth + 1))


def _scoped_roots(app) -> list:
    try:
        count = app.get_child_count()
    except Exception:
        return [app]
    for i in range(min(int(count or 0), 8)):
        win = _call_timeout(lambda index=i: app.get_child_at_index(index), 0.12, None)
        if win is None:
            continue
        title = (_accessible_name(win) or "").lower()
        role = str(_call_timeout(lambda: win.get_role_name() if hasattr(win, "get_role_name") else "", 0.08, "") or "").lower()
        if "war room" in title or role in ("frame", "window"):
            return [win]
    return [app]


def _call_timeout(fn, timeout: float = 0.45, default=None):
    box = [default]
    def run() -> None:
        try:
            box[0] = fn()
        except Exception:
            pass
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        return default
    return box[0]


def _accessible_name(node) -> str | None:
    if node is None:
        return None
    name = _call_timeout(lambda: node.get_name() or "", 0.18, None)
    if name is None:
        return None
    return str(name)


def _desktop_child(desktop, index: int):
    return _call_timeout(lambda: desktop.get_child_at_index(index), 0.18, None)


def _app_matches(app_name: str, wanted: str | None) -> bool:
    if not wanted:
        return True
    name = (app_name or "").strip().lower()
    needle = str(wanted).strip().lower()
    if not name or not needle:
        return False
    if needle in name or name in needle:
        return True
    compact_name = name.replace(" ", "-").replace("_", "-")
    compact_wanted = needle.replace(" ", "-").replace("_", "-")
    if compact_wanted in compact_name or compact_name in compact_wanted:
        return True
    war_wanted = any(token in compact_wanted for token in ("war-room", "warroom", "higher-vision"))
    war_app = any(token in compact_name for token in ("war-room", "warroom", "higher-vision"))
    return war_wanted and war_app


def _excluded_desktop_app(app_name: str) -> bool:
    name = (app_name or "").strip().lower()
    if not name:
        return True
    if any(token in name for token in ("war-room", "war room", "warroom", "higher vision")):
        return False
    return any(token in name for token in (
        "cursor",
        "google-chrome",
        "chromium",
        "gnome-shell",
        "gnome-terminal",
        "xfce4-terminal",
        "tilix",
        "code-oss",
    ))


_WR_CACHE: dict = {"index": None, "name": None, "title": None, "hungIndexes": []}


def _load_cache() -> None:
    try:
        with open(CACHE_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            _WR_CACHE["index"] = data.get("index")
            _WR_CACHE["name"] = data.get("name")
            _WR_CACHE["title"] = data.get("title")
            hung = data.get("hungIndexes") or []
            if isinstance(hung, list):
                _WR_CACHE["hungIndexes"] = [int(item) for item in hung if isinstance(item, (int, float))]
    except Exception:
        pass


def _save_cache() -> None:
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as handle:
            json.dump(_WR_CACHE, handle)
    except Exception:
        pass


_load_cache()


def invalidate_control_nodes() -> dict:
    return {"ok": True, "controlNodesInvalidated": True, "cached": dict(_WR_CACHE)}


def invalidate_cache() -> dict:
    hung = list(_WR_CACHE.get("hungIndexes") or [])
    _WR_CACHE["index"] = None
    _WR_CACHE["name"] = None
    _WR_CACHE["title"] = None
    _WR_CACHE["hungIndexes"] = hung
    _save_cache()
    return {"ok": True, "invalidated": True, "cached": dict(_WR_CACHE)}


def _remember_hung(index: int) -> None:
    hung = [int(item) for item in (_WR_CACHE.get("hungIndexes") or [])]
    if index not in hung:
        hung.append(index)
        _WR_CACHE["hungIndexes"] = hung[-48:]
        _save_cache()


def cache_status() -> dict:
    return {"ok": True, "cached": dict(_WR_CACHE)}


def _should_skip_app_name(name: str | None) -> str | None:
    if name is None:
        return "hung"
    if not str(name).strip():
        return "unnamed"
    return None


def _discover_desktop_apps() -> tuple[list[tuple[object | None, str, int]], list[dict]]:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
    desktop = Atspi.get_desktop(0)
    apps: list[tuple[object | None, str, int]] = []
    skipped: list[dict] = []
    hung = {int(item) for item in (_WR_CACHE.get("hungIndexes") or [])}
    deadline = time.monotonic() + 0.9
    count = int(_call_timeout(lambda: desktop.get_child_count(), 0.12, 0) or 0)
    for i in range(min(count, 48)):
        if time.monotonic() >= deadline:
            skipped.append({"index": i, "reason": "discover-budget"})
            apps.append((None, f"<budget:{i}>", i))
            break
        if i in hung:
            apps.append((None, f"<hung:{i}>", i))
            skipped.append({"index": i, "reason": "hung-cached"})
            continue
        app = _call_timeout(lambda index=i: desktop.get_child_at_index(index), 0.08, None)
        if app is None:
            _remember_hung(i)
            apps.append((None, f"<hung:{i}>", i))
            skipped.append({"index": i, "reason": "hung"})
            continue
        inspected = _call_timeout(lambda node=app: node.get_name() or "", 0.08, None)
        reason = _should_skip_app_name(inspected if inspected is not None else None)
        if inspected is None or reason:
            if inspected is None:
                _remember_hung(i)
            label = f"<hung-name:{i}>" if (inspected is None or reason == "hung") else f"<unnamed:{i}>"
            apps.append((None, label, i))
            skipped.append({"index": i, "reason": reason or "hung"})
            continue
        apps.append((app, inspected, i))
    return apps, skipped


def _select_target_apps(app_name: str | None) -> tuple[list, list[str], list[str], list[dict]]:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
    needle = app_name or "war-room-os"
    desktop = Atspi.get_desktop(0)
    cached_index = _WR_CACHE.get("index")
    hung = {int(item) for item in (_WR_CACHE.get("hungIndexes") or [])}
    if cached_index is not None and int(cached_index) not in hung:
        app = _desktop_child(desktop, int(cached_index))
        name = _accessible_name(app)
        if name and (_app_matches(name, needle) or _app_matches(name, str(_WR_CACHE.get("name") or "war-room-os"))):
            return [(app, name)], [name], [name], []
        _WR_CACHE["index"] = None
    discovered, skipped = _discover_desktop_apps()
    inspected_names = [name for _, name, _ in discovered]
    matched: list = []
    matched_meta: list[tuple[object, str, int]] = []
    for app, inspected, index in discovered:
        if app is None:
            continue
        if _excluded_desktop_app(inspected) and not _app_matches(inspected, needle):
            continue
        if _app_matches(inspected, needle):
            matched.append((app, inspected))
            matched_meta.append((app, inspected, index))
    if not matched:
        for app, inspected, index in discovered:
            if app is None or _excluded_desktop_app(inspected):
                continue
            if _app_matches(inspected, "war-room-os") or _app_matches(inspected, "War Room OS") or _app_matches(inspected, "War Room — Higher Vision Inc"):
                matched.append((app, inspected))
                matched_meta.append((app, inspected, index))
    if matched_meta:
        app, inspected, index = matched_meta[0]
        title = ""
        try:
            roots = _scoped_roots(app)
            if roots:
                title = (_accessible_name(roots[0]) or "")[:200]
        except Exception:
            title = ""
        _WR_CACHE["index"] = index
        _WR_CACHE["name"] = inspected
        _WR_CACHE["title"] = title
        _save_cache()
    return matched, inspected_names, [name for _, name in matched], skipped


def _walk_activate(root, needle: str, role: str | None, best: dict) -> dict:
    import time
    from collections import deque
    deadline = time.monotonic() + 2.4
    queue = deque([(root, 0)])
    seen = 0
    while queue and seen < 400 and time.monotonic() < deadline:
        node, depth = queue.popleft()
        seen += 1
        try:
            name = (node.get_name() or "").strip()
            role_name = node.get_role_name() if hasattr(node, "get_role_name") else ""
            needle_l = (needle or "").strip().lower()
            name_l = name.lower()
            if needle_l and name_l == needle_l and _role_ok(str(role_name), role):
                score = 100
                if role and role.lower() in str(role_name).lower():
                    score += 20
                elif "button" in str(role_name).lower() or "link" in str(role_name).lower():
                    score += 15
                if score >= int(best.get("score") or -1):
                    ext = node.get_extents(0) if hasattr(node, "get_extents") else None
                    area = 0
                    try:
                        area = max(0, int(getattr(ext, "width", 0) or 0)) * max(0, int(getattr(ext, "height", 0) or 0))
                    except Exception:
                        area = 0
                    if score > int(best.get("score") or -1) or area >= int(best.get("area") or 0):
                        best = {"node": node, "score": score, "name": name, "role": str(role_name), "area": area}
                        if score >= 120:
                            return best
        except Exception:
            pass
        if depth >= 24:
            continue
        try:
            count = node.get_child_count()
        except Exception:
            continue
        for i in range(min(int(count or 0), 80)):
            try:
                child = node.get_child_at_index(i)
            except Exception:
                continue
            if child is not None:
                queue.append((child, depth + 1))
    return best


def activate_control(name: str, role: str | None, app_name: str | None) -> dict:
    best: dict = {}
    matched, apps, matched_apps, skipped = _select_target_apps(app_name)
    for app, _inspected in matched:
        for root in _scoped_roots(app):
            best = _walk_activate(root, name, role, best)
            if best.get("node"):
                break
        if best.get("node"):
            break
    if not best.get("node"):
        return {
            "ok": False,
            "error": "no exact accessible-name match",
            "appsInspected": apps[:40],
            "appsMatched": matched_apps[:20],
            "skippedApps": skipped[:20],
            "cachedApp": _WR_CACHE.get("name"),
            "strategy": "accessible-action",
        }
    node = best["node"]
    try:
        n_actions = int(node.get_n_actions()) if hasattr(node, "get_n_actions") else 0
    except Exception:
        n_actions = 0
    if n_actions <= 0:
        return {"ok": False, "error": "control has no AT-SPI action", "name": best.get("name"), "role": best.get("role"), "strategy": "accessible-action"}
    try:
        names = []
        clicked = False
        for i in range(n_actions):
            try:
                action_name = str(node.get_action_name(i) or "").lower()
            except Exception:
                action_name = ""
            names.append(action_name or f"action-{i}")
        preferred = None
        for i, action_name in enumerate(names):
            if action_name in {"click", "activate", "jump"}:
                preferred = i
                break
        if preferred is None:
            for i, action_name in enumerate(names):
                if action_name in {"press", ""} or i == 0:
                    preferred = i
                    break
        if preferred is not None:
            try:
                node.grab_focus()
            except Exception:
                pass
            clicked = bool(node.do_action(preferred))
            # Chromium exposes press + showContextMenu. Never invoke the context-menu action.
            # press alone is treated as a possible no-op by the TS state-confirmation layer.
            # Do not generate_mouse_event from raw AT-SPI SCREEN coords: on HiDPI/multi-monitor
            # those extents mix GDK logical frames with X11 physical widget bounds.
        ok = clicked
    except Exception as exc:
        return {"ok": False, "error": str(exc), "name": best.get("name"), "role": best.get("role"), "strategy": "accessible-action"}
    return {
        "ok": ok,
        "name": best.get("name"),
        "role": best.get("role"),
        "score": best.get("score"),
        "actions": n_actions,
        "actionNames": names[:12],
        "strategy": "accessible-action",
        "appsInspected": apps[:40],
        "appsMatched": matched_apps[:20],
        "skippedApps": skipped[:20],
        "cachedApp": _WR_CACHE.get("name"),
        "controlNodeInvalidated": True,
        "actionSuccessDoesNotImplyState": True,
    }


def _normalize_name(name: str) -> str:
    return " ".join((name or "").replace("+", " ").strip().lower().split())


def _walk_named(app, needle: str, role: str | None) -> list:
    """Dump-style BFS on the live War Room frame only. Bounded, visible, exact/normalized name."""
    from collections import deque
    needle_l = _normalize_name(needle)
    hits: list = []
    queue = deque([(app, 0)])
    seen = 0
    deadline = time.monotonic() + 1.6
    while queue and seen < 800 and len(hits) < 8 and time.monotonic() < deadline:
        node, depth = queue.popleft()
        seen += 1
        try:
            name = (node.get_name() or "") if hasattr(node, "get_name") else ""
        except Exception:
            name = ""
        try:
            role_name = node.get_role_name() if hasattr(node, "get_role_name") else ""
        except Exception:
            role_name = ""
        if needle_l and _normalize_name(name) == needle_l and _role_ok(str(role_name), role):
            try:
                ext = node.get_extents(0) if hasattr(node, "get_extents") else None
            except Exception:
                ext = None
            x = getattr(ext, "x", None)
            y = getattr(ext, "y", None)
            width = getattr(ext, "width", None)
            height = getattr(ext, "height", None)
            visible = isinstance(width, (int, float)) and isinstance(height, (int, float)) and width >= 8 and height >= 8
            if isinstance(x, (int, float)) and isinstance(y, (int, float)) and visible:
                action_names = []
                try:
                    n_actions = int(node.get_n_actions()) if hasattr(node, "get_n_actions") else 0
                    for ai in range(min(n_actions, 8)):
                        try:
                            action_names.append(str(node.get_action_name(ai) or ""))
                        except Exception:
                            action_names.append("")
                except Exception:
                    action_names = []
                hits.append({
                    "name": name[:200],
                    "role": str(role_name),
                    "text": name[:240],
                    "strategy": "accessible-name",
                    "score": 130 if role else 110,
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "exact": True,
                    "nodesVisited": seen,
                    "actionNames": action_names,
                    "pressWithoutClick": [a.lower() for a in action_names[:1]] == ["press"] and "click" not in [a.lower() for a in action_names],
                })
        if depth >= 16:
            continue
        try:
            count = int(node.get_child_count() or 0)
        except Exception:
            count = 0
        for i in range(min(count, 48)):
            try:
                child = node.get_child_at_index(i)
            except Exception:
                child = None
            if child is not None:
                queue.append((child, depth + 1))
    return hits


def find_text(needle: str, app_name: str | None) -> dict:
    return find_control(needle, None, app_name)


def find_control(name: str, role: str | None, app_name: str | None) -> dict:
    hits: list = []
    matched, apps, matched_apps, skipped = _select_target_apps(app_name)
    for app, inspected in matched:
        for root in _scoped_roots(app):
            hits.extend(_walk_named(root, name, role))
            if hits:
                break
        if hits:
            break
        hits.extend(_walk_named(app, name, role))
        if hits:
            break
    hits.sort(key=lambda item: (int(item.get("width") or 0) * int(item.get("height") or 0), -int(item.get("score") or 0)))
    return {
        "ok": True,
        "hits": hits,
        "appsInspected": apps[:40],
        "appsMatched": matched_apps[:20],
        "skippedApps": skipped[:20],
        "cachedApp": _WR_CACHE.get("name") or (matched_apps[0] if matched_apps else None),
        "cachedIndex": _WR_CACHE.get("index"),
        "backend": "atspi",
        "strategy": "war-room-app-cache" if _WR_CACHE.get("name") else "semantic",
        "query": {"name": name, "role": role, "app": app_name},
    }


def windows_atspi() -> dict:
    discovered, skipped = _discover_desktop_apps()
    windows = []
    for app, app_name, _index in discovered:
        windows.append({
            "app": app_name,
            "title": "" if app is None else app_name[:200],
            "role": "application",
            "skipped": app is None,
            "skippedChildren": True,
            "reason": None if app is not None else ("hung" if str(app_name).startswith("<hung") else "unnamed"),
        })
    return {
        "ok": True,
        "windows": windows,
        "skippedApps": skipped[:20],
        "cachedApp": _WR_CACHE.get("name"),
        "backend": "atspi",
        "strategy": "bounded-skip-hung",
    }


def app_window(app_filter: str | None = None) -> dict:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
    needle = (app_filter or "war-room").strip().lower()
    desktop = Atspi.get_desktop(0)
    count = int(_call_timeout(lambda: desktop.get_child_count(), 0.12, 0) or 0)
    for i in range(min(count, 48)):
        app = _call_timeout(lambda index=i: desktop.get_child_at_index(index), 0.08, None)
        if app is None:
            continue
        name = _call_timeout(lambda node=app: node.get_name() or "", 0.08, "") or ""
        if needle and needle not in name.lower() and "war" not in name.lower():
            continue
        child_count = int(_call_timeout(lambda node=app: node.get_child_count(), 0.08, 0) or 0)
        for j in range(min(child_count, 6)):
            win = _call_timeout(lambda node=app, index=j: node.get_child_at_index(index), 0.08, None)
            if win is None:
                continue
            title = _call_timeout(lambda node=win: node.get_name() or "", 0.08, "") or ""
            role = _call_timeout(lambda node=win: node.get_role_name() if hasattr(node, "get_role_name") else "", 0.08, "") or ""
            screen = _call_timeout(lambda node=win: node.get_extents(0) if hasattr(node, "get_extents") else None, 0.12, None)
            window = _call_timeout(lambda node=win: node.get_extents(1) if hasattr(node, "get_extents") else None, 0.12, None)
            if screen is None:
                continue
            return {
                "ok": True,
                "app": name,
                "title": title[:200],
                "role": str(role),
                "screen": {
                    "x": getattr(screen, "x", None),
                    "y": getattr(screen, "y", None),
                    "width": getattr(screen, "width", None),
                    "height": getattr(screen, "height", None),
                },
                "window": None if window is None else {
                    "x": getattr(window, "x", None),
                    "y": getattr(window, "y", None),
                    "width": getattr(window, "width", None),
                    "height": getattr(window, "height", None),
                },
                "coordinateSpace": "atspi-screen-often-gdk-logical",
            }
    return {"ok": False, "error": "War Room AT-SPI frame not found"}


def main() -> int:
    if len(sys.argv) < 2:
        fail("BLOCKED", "USAGE", "missing command", [], "n/a", "pass a command")
        os._exit(2)
    command = sys.argv[1]
    payload = {}
    if len(sys.argv) > 2:
        payload = json.loads(sys.argv[2])
    try:
        if command == "screens":
            out(screens())
        elif command == "clipboard_read":
            out(clipboard_read())
        elif command == "clipboard_write":
            out(clipboard_write(str(payload.get("text") or "")))
        elif command == "screenshot":
            result = screenshot(str(payload.get("path") or "/tmp/foundry-cu.png"), payload.get("xid"))
            if result:
                out(result)
        elif command == "find_text":
            out(find_text(str(payload.get("text") or payload.get("name") or ""), payload.get("app")))
        elif command == "find_control":
            role = payload.get("role")
            out(find_control(str(payload.get("name") or payload.get("text") or ""), str(role) if role else None, payload.get("app")))
        elif command == "activate_control":
            role = payload.get("role")
            out(activate_control(str(payload.get("name") or payload.get("text") or ""), str(role) if role else None, payload.get("app")))
        elif command == "windows":
            out(windows_atspi())
        elif command == "app_window":
            out(app_window(payload.get("app")))
        elif command == "invalidate_cache":
            out(invalidate_cache())
        elif command == "invalidate_control_nodes":
            out(invalidate_control_nodes())
        elif command == "cache_status":
            out(cache_status())
        else:
            fail("BLOCKED", "UNKNOWN_COMMAND", command, [], "n/a", "use a known command")
            os._exit(2)
        os._exit(0)
    except Exception as e:
        fail("BLOCKED", "BACKEND_EXCEPTION", str(e), [command], str(e), "inspect the exception and retry with a narrower backend")
        os._exit(1)


if __name__ == "__main__":
    raise SystemExit(main())
