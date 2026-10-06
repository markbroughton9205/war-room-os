#!/usr/bin/env python3
"""Render a seamless light-loop from the exact Higher Vision Studios icon PNG.

Does not redraw the tree, television, or composition. Source PNG is read-only.
Run with: /usr/bin/python3 scripts/hvs-animate-home-icon.py
"""
from __future__ import annotations

import math
import os
import struct
import subprocess
import sys
from pathlib import Path

REPO = Path("/home/chosenone/Codex/war-room-os")
SOURCE_PUBLIC = REPO / "public/hvs/higher-vision-studios-icon.png"
OUT_GIF = REPO / "public/hvs/higher-vision-studios-icon-animated.gif"
OUT_WEBP = REPO / "public/hvs/higher-vision-studios-icon-animated.webp"
WORK = REPO / ".tmp/hvs-icon-anim"
FRAMES_DIR = WORK / "frames"
PROOF_DIR = WORK / "proof"
NUMPY_PY = "/home/chosenone/.local/share/war-room-os/venvs/wrim-pytorch-linux/bin/python"
PIL_PY = "/usr/bin/python3"

SIZE = 512
FPS = 12
DURATION = 4.0
FRAME_COUNT = 48  # 12 fps * 4s; t = i/N so last frame is just before t=1


DUMP_PY = r"""
from PIL import Image
import sys
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGB')
im = im.resize((size, size), Image.Resampling.LANCZOS)
im.save(dst, 'PNG')
open(dst + '.rgb', 'wb').write(im.tobytes())
print('dumped', im.size, 'mode', im.mode)
"""

PROCESS_PY = r"""
import math
import os
import sys
import numpy as np

raw_path, out_dir, size, frame_count, duration = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5])
base_u8 = np.fromfile(raw_path, dtype=np.uint8)
assert base_u8.size == size * size * 3, (base_u8.size, size)
base = base_u8.reshape(size, size, 3).astype(np.float32) / 255.0
yy, xx = np.mgrid[0:size, 0:size]
nx = xx / (size - 1)
ny = yy / (size - 1)

r = base[..., 0]
g = base[..., 1]
b = base[..., 2]
luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

# Color roles (existing pixels only — no new artwork).
goldness = np.clip(((r - b) * 1.15) * (r >= 0.42).astype(np.float32) * np.clip((r - 0.12) / 0.55, 0, 1), 0, 1)
goldness *= np.clip((r - g * 0.35), 0, 1)
cyanness = np.clip(((b - r) * 1.35) * (b >= 0.22).astype(np.float32) * np.clip((g - 0.12) / 0.55, 0, 1), 0, 1)
canopy = np.clip((g - r * 0.82) * 2.4, 0, 1) * np.clip((g - b * 0.55), 0, 1)
canopy *= (ny > 0.22) * (ny < 0.55)

# Television screen (vision) vs chrome.
sx = (nx - 0.50) / 0.312
sy = (ny - 0.405) / 0.255
screen = np.clip(1.0 - (np.abs(sx) ** 8.0 + np.abs(sy) ** 8.0), 0.0, 1.0)

# Outer gold rounded-square trim (the identity frame).
fx = (nx - 0.50) / 0.455
fy = (ny - 0.50) / 0.455
outer = np.clip(1.0 - (np.abs(fx) ** 12.0 + np.abs(fy) ** 12.0), 0.0, 1.0)
inner = np.clip(1.0 - (np.abs((nx - 0.50) / 0.405) ** 12.0 + np.abs((ny - 0.50) / 0.405) ** 12.0), 0.0, 1.0)
frame_band = np.clip(outer - inner * 0.82, 0, 1)

sun_dx = nx - 0.501
sun_dy = ny - 0.385
sun_r = np.sqrt(sun_dx * sun_dx + sun_dy * sun_dy)
sun = np.exp(-(sun_r ** 2) / (2.0 * 0.168 ** 2))
sun_core = np.exp(-(sun_r ** 2) / (2.0 * 0.078 ** 2))
theta = np.arctan2(sun_dy, sun_dx)

# Trunk / root gold vein region.
trunk = np.exp(-((nx - 0.50) ** 2) / (2.0 * 0.072 ** 2) - ((ny - 0.495) ** 2) / (2.0 * 0.095 ** 2))
trunk *= (ny > 0.38) * (ny < 0.62)
root = np.exp(-((nx - 0.50) ** 2) / (2.0 * 0.10 ** 2) - ((ny - 0.56) ** 2) / (2.0 * 0.06 ** 2))
tree_energy = np.clip(trunk * 0.75 + root * 0.55, 0, 1) * goldness

highlight = np.clip((luma - 0.42) / 0.50, 0, 1)
flare_dx = nx - 0.498
flare_dy = ny - 0.196
flare_r = np.sqrt(flare_dx * flare_dx + flare_dy * flare_dy)
flare_ang = np.arctan2(flare_dy, flare_dx)

gold_col = np.array([1.0, 0.84, 0.32], dtype=np.float32)
warm = np.array([1.0, 0.90, 0.55], dtype=np.float32)
cyan_col = np.array([0.18, 0.82, 1.0], dtype=np.float32)

# Tiny looping particles (positions return via periodic motion).
rng = np.random.default_rng(20260922)
n_particles = 9
p_x = rng.uniform(0.34, 0.66, n_particles)
p_y = rng.uniform(0.28, 0.58, n_particles)
p_ph = rng.uniform(0, 2 * math.pi, n_particles)
p_sig = rng.uniform(0.0038, 0.0062, n_particles)

os.makedirs(out_dir, exist_ok=True)

def cosine_pulse(t: float) -> float:
    # 0 at rest, 1 at t=0.5, 0 at t=1
    return 0.5 - 0.5 * math.cos(2.0 * math.pi * t)

for i in range(frame_count):
    t = i / frame_count
    pulse = cosine_pulse(t)
    peak = pulse ** 2.15  # flare envelope — sharper at radiant max

    out = base.copy()

    # 1. Sun pulse — warm multiplicative lift + soft additive bloom. Structure unchanged.
    sun_lift = (sun * (1.0 - 0.55 * canopy) * screen)
    out *= (1.0 + sun_lift[..., None] * pulse * 0.17)
    out += (sun_core * screen * pulse * 0.09)[..., None] * gold_col

    # 2. Moving golden rays — expand outward from the sun. Restrained, behind canopy.
    ray_wave = 0.5 + 0.5 * np.sin(18.0 * theta + sun_r * 9.5 - 2.0 * math.pi * t)
    rays = np.clip(ray_wave, 0, 1) ** 2.4
    radial = np.clip((sun_r - 0.045) / 0.34, 0, 1) * np.exp(-sun_r / 0.33)
    ray_mask = rays * radial * screen * (1.0 - 0.78 * canopy) * (0.35 + 0.65 * goldness)
    ray_amt = 0.205 * pulse
    out += ray_mask[..., None] * ray_amt * gold_col

    # 3. Cinematic gold shimmer sweep LEFT -> CENTER -> RIGHT once per loop.
    sweep_x = 0.20 + 0.60 * t
    band = np.exp(-((nx - sweep_x) ** 2) / (2.0 * 0.042 ** 2))
    sweep_target = np.clip(0.62 * goldness + 0.38 * highlight, 0, 1)
    sweep_mask = band * sweep_target * np.clip(screen + frame_band * 0.85, 0, 1)
    sweep_mask *= (1.0 - 0.35 * canopy)
    out += sweep_mask[..., None] * pulse * 0.155 * warm

    # 4. Tree energy glow — existing gold veins only, 100% -> ~120% -> 100%.
    energy = tree_energy * screen
    out *= (1.0 + energy[..., None] * pulse * 0.20)
    out += (energy * pulse * 0.05)[..., None] * gold_col

    # 5. Soft cinematic flare at the existing sun apex, peak only.
    spikes = np.clip(np.cos(3.0 * flare_ang), 0, 1) ** 18.0
    spikes *= np.exp(-flare_r / 0.11)
    bloom = np.exp(-(flare_r ** 2) / (2.0 * 0.028 ** 2))
    cross = np.clip(np.cos(2.0 * flare_ang), 0, 1) ** 22.0 * np.exp(-flare_r / 0.09)
    flare = (0.42 * spikes + 0.38 * bloom + 0.20 * cross) * screen
    out += flare[..., None] * peak * 0.48 * warm

    # 6. Cyan TV accents — very slight breath, gold remains primary.
    out += (cyanness * pulse * 0.055)[..., None] * cyan_col

    # Gold frame / wordmark trim — restrained identity pulse.
    trim = frame_band * goldness
    out *= (1.0 + trim[..., None] * pulse * 0.07)
    out += (trim * pulse * 0.035)[..., None] * gold_col

    # 7. Subliminal rising gold motes inside the vision (few, tiny, pulse-gated).
    for px, py, ph, sig in zip(p_x, p_y, p_ph, p_sig):
        py_t = py - 0.028 * math.sin(2.0 * math.pi * t + ph)
        alpha = pulse * 0.22 * (0.45 + 0.55 * math.sin(2.0 * math.pi * t + ph))
        if alpha <= 0.01:
            continue
        mote = np.exp(-((nx - px) ** 2 + (ny - py_t) ** 2) / (2.0 * sig ** 2)) * screen
        out += mote[..., None] * alpha * gold_col

    out = np.clip(out, 0.0, 1.0)
    frame = np.round(out * 255.0).astype(np.uint8)
    path = os.path.join(out_dir, f'frame_{i:03d}.png.rgb')
    frame.tofile(path)
    if i in (0, 12, 24, 36, 47):
        print('frame', i, 't', round(t, 4), 'pulse', round(pulse, 4), 'mean', round(float(out.mean()), 4))

print('wrote', frame_count, 'raw frames')
"""

ENCODE_PY = r"""
from PIL import Image
import os, sys
from pathlib import Path

frames_dir = Path(sys.argv[1])
size = int(sys.argv[2])
fps = int(sys.argv[3])
gif_path = sys.argv[4]
webp_path = sys.argv[5]
proof_dir = Path(sys.argv[6])
proof_dir.mkdir(parents=True, exist_ok=True)

rgb_files = sorted(frames_dir.glob('frame_*.png.rgb'))
assert rgb_files, 'no frames'
duration_ms = int(round(1000 / fps))

frames = []
for p in rgb_files:
    data = p.read_bytes()
    im = Image.frombytes('RGB', (size, size), data)
    frames.append(im)

# Proof stills: rest vs peak
frames[0].save(proof_dir / 'rest.jpg', 'JPEG', quality=92)
peak_i = min(range(len(frames)), key=lambda i: abs(i / len(frames) - 0.5))
frames[peak_i].save(proof_dir / 'peak.jpg', 'JPEG', quality=92)
frames[0].save(proof_dir / 'rest.png')
frames[peak_i].save(proof_dir / 'peak.png')
print('proof frames', 0, peak_i)

# Consistent GIF palette from rest+peak to reduce flicker/banding.
sheet = Image.new('RGB', (size * 2, size))
sheet.paste(frames[0], (0, 0))
sheet.paste(frames[peak_i], (size, 0))
try:
    palette = sheet.quantize(colors=256, method=Image.Quantize.LIBIMAGEQUANT, dither=Image.Dither.FLOYDSTEINBERG)
    qmethod = 'libimagequant'
except Exception as exc:
    palette = sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
    qmethod = f'mediancut:{exc}'

quantized = []
for im in frames:
    q = im.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG)
    quantized.append(q)

quantized[0].save(
    gif_path,
    save_all=True,
    append_images=quantized[1:],
    duration=duration_ms,
    loop=0,
    optimize=False,
    disposal=2,
)
print('gif', gif_path, os.path.getsize(gif_path), 'palette', qmethod, 'duration_ms', duration_ms)

webp_ok = False
webp_err = ''
try:
    frames[0].save(
        webp_path,
        format='WEBP',
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        quality=82,
        method=6,
    )
    webp_ok = os.path.exists(webp_path) and os.path.getsize(webp_path) > 1000
except Exception as exc:
    webp_err = str(exc)
print('webp', webp_ok, webp_path if webp_ok else webp_err, os.path.getsize(webp_path) if webp_ok else 0)
"""


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(cmd[:6]), "...")
    subprocess.check_call(cmd, cwd=str(cwd) if cwd else None)


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    PROOF_DIR.mkdir(parents=True, exist_ok=True)
    if not SOURCE_PUBLIC.exists():
        sys.exit(f"missing source copy {SOURCE_PUBLIC}")
    sized_png = WORK / f"source-{SIZE}.png"
    run([PIL_PY, "-c", DUMP_PY, str(SOURCE_PUBLIC), str(sized_png), str(SIZE)])
    raw = str(sized_png) + ".rgb"
    run([NUMPY_PY, "-c", PROCESS_PY, raw, str(FRAMES_DIR), str(SIZE), str(FRAME_COUNT), str(DURATION)])
    run([PIL_PY, "-c", ENCODE_PY, str(FRAMES_DIR), str(SIZE), str(FPS), str(OUT_GIF), str(OUT_WEBP), str(PROOF_DIR)])
    print("SOURCE", SOURCE_PUBLIC, SOURCE_PUBLIC.stat().st_size)
    print("GIF", OUT_GIF, OUT_GIF.stat().st_size if OUT_GIF.exists() else "missing")
    print("WEBP", OUT_WEBP, OUT_WEBP.stat().st_size if OUT_WEBP.exists() else "missing")


if __name__ == "__main__":
    main()
