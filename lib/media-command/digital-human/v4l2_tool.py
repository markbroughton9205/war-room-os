#!/usr/bin/env python3
"""Explicit V4L2 helper for HVS performance capture.

--audit never starts streaming.
--capture is the only path that calls STREAMON, and it always STREAMOFF and closes the fd.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import fcntl
import json
import mmap
import os
import struct
import time

QUERYCAP = 2154321408
ENUM_FMT = 3225441794
ENUM_FRAMESIZES = 3224131146
ENUM_FRAMEINTERVALS = 3224655435
S_FMT = 3234878981
G_FMT = 3234878980
REQBUFS = 3222558216
QUERYBUF = 3227014665
QBUF = 3227014671
DQBUF = 3227014673
STREAMON = 1074026002
STREAMOFF = 1074026003

CAP_VIDEO_CAPTURE = 0x1
CAP_META_CAPTURE = 0x800000
VIDEO_CAPTURE = 1
MEMORY_MMAP = 1
FIELD_NONE = 1


def fourcc(value: int) -> str:
    raw = struct.pack('<I', value)
    return raw.decode('ascii', 'replace').strip('\x00')


def pack_fourcc(text: str) -> int:
    return struct.unpack('<I', text.encode('ascii')[:4].ljust(4, b'\0'))[0]


def open_node(path: str):
    return os.open(path, os.O_RDWR | os.O_NONBLOCK)


def querycap(fd: int) -> dict:
    buf = bytearray(104)
    fcntl.ioctl(fd, QUERYCAP, buf, True)
    driver = buf[0:16].split(b'\0', 1)[0].decode()
    card = buf[16:48].split(b'\0', 1)[0].decode()
    bus = buf[48:80].split(b'\0', 1)[0].decode()
    version, caps, devcaps = struct.unpack_from('<III', buf, 80)
    return {
        'driver': driver,
        'card': card,
        'bus': bus,
        'version': version,
        'capabilities': caps,
        'deviceCaps': devcaps,
    }


def enum_formats(fd: int) -> list[dict]:
    formats = []
    for index in range(16):
        buf = bytearray(64)
        struct.pack_into('<II', buf, 0, index, VIDEO_CAPTURE)
        try:
            fcntl.ioctl(fd, ENUM_FMT, buf, True)
        except OSError:
            break
        pix = struct.unpack_from('<I', buf, 44)[0]
        desc = buf[12:44].split(b'\0', 1)[0].decode(errors='replace')
        sizes = []
        for size_index in range(40):
            sb = bytearray(44)
            struct.pack_into('<II', sb, 0, size_index, pix)
            try:
                fcntl.ioctl(fd, ENUM_FRAMESIZES, sb, True)
            except OSError:
                break
            width, height = struct.unpack_from('<II', sb, 12)
            sizes.append({'width': width, 'height': height})
        formats.append({'pixelFormat': fourcc(pix), 'description': desc, 'sizes': sizes})
    return formats


def frame_rates(fd: int, pixel_format: str, width: int, height: int) -> list[float]:
    pix = pack_fourcc(pixel_format)
    rates = []
    for index in range(16):
        buf = bytearray(52)
        struct.pack_into('<IIII', buf, 0, index, pix, width, height)
        try:
            fcntl.ioctl(fd, ENUM_FRAMEINTERVALS, buf, True)
        except OSError:
            break
        numerator, denominator = struct.unpack_from('<II', buf, 20)
        if numerator:
            rates.append(round(denominator / numerator, 3))
    return rates


def audio_cards() -> list[dict]:
    path = '/proc/asound/cards'
    if not os.path.exists(path):
        return []
    text = open(path, encoding='utf8', errors='replace').read()
    cards = []
    for line in text.splitlines():
        if '[' in line and ']' in line:
            cards.append({'line': line.strip()})
    return cards


def audit() -> dict:
    nodes = []
    root = '/sys/class/video4linux'
    names = sorted(os.listdir(root)) if os.path.isdir(root) else []
    for name in names:
        dev = f'/dev/{name}'
        if not os.path.exists(dev):
            continue
        try:
            fd = os.open(dev, os.O_RDONLY | os.O_NONBLOCK)
        except OSError as error:
            nodes.append({'id': name, 'node': dev, 'error': str(error)})
            continue
        try:
            cap = querycap(fd)
            capture = bool(cap['deviceCaps'] & CAP_VIDEO_CAPTURE)
            formats = enum_formats(fd) if capture else []
            sample_rates = {}
            if capture:
                for key in (('MJPG', 1280, 720), ('MJPG', 1920, 1080), ('YUYV', 640, 480)):
                    sample_rates[f'{key[0]}:{key[1]}x{key[2]}'] = frame_rates(fd, key[0], key[1], key[2])
            nodes.append({
                'id': name,
                'node': dev,
                'label': cap['card'],
                'driver': cap['driver'],
                'bus': cap['bus'],
                'deviceCaps': cap['deviceCaps'],
                'capture': capture,
                'metadata': bool(cap['deviceCaps'] & CAP_META_CAPTURE) and not capture,
                'formats': formats,
                'sampleRates': sample_rates,
                'streaming': False,
            })
        finally:
            os.close(fd)
    return {
        'devices': nodes,
        'audioCards': audio_cards(),
        'latencyMs': None,
        'streamStarted': False,
    }


def set_format(fd: int, width: int, height: int, pixel_format: str) -> dict:
    buf = bytearray(208)
    struct.pack_into('<I', buf, 0, VIDEO_CAPTURE)
    struct.pack_into('<IIII', buf, 8, width, height, pack_fourcc(pixel_format), FIELD_NONE)
    fcntl.ioctl(fd, S_FMT, buf, True)
    fcntl.ioctl(fd, G_FMT, buf, True)
    got_w, got_h, pix, _field, _bpl, sizeimage = struct.unpack_from('<IIIIII', buf, 8)
    return {'width': got_w, 'height': got_h, 'pixelFormat': fourcc(pix), 'sizeImage': sizeimage}


def open_probe(device: str, width: int, height: int) -> dict:
    """Open the capture node and set format. Never STREAMON. Always close the fd."""
    fd = open_node(device)
    try:
        cap = querycap(fd)
        fmt = set_format(fd, width, height, 'MJPG')
        return {
            'ok': True,
            'device': device,
            'opened': True,
            'streamed': False,
            'closed': True,
            'label': cap['card'],
            'width': fmt['width'],
            'height': fmt['height'],
            'pixelFormat': fmt['pixelFormat'],
        }
    finally:
        os.close(fd)


def capture(device: str, out_path: str, frames: int, width: int, height: int) -> dict:
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    fd = open_node(device)
    streaming = False
    mapped = []
    started = time.monotonic()
    try:
        fmt = set_format(fd, width, height, 'MJPG')
        req = bytearray(20)
        struct.pack_into('<III', req, 0, 2, VIDEO_CAPTURE, MEMORY_MMAP)
        fcntl.ioctl(fd, REQBUFS, req, True)
        for index in range(2):
            buf = bytearray(88)
            struct.pack_into('<II', buf, 0, index, VIDEO_CAPTURE)
            struct.pack_into('<I', buf, 60, MEMORY_MMAP)
            fcntl.ioctl(fd, QUERYBUF, buf, True)
            offset = struct.unpack_from('<I', buf, 64)[0]
            length = struct.unpack_from('<I', buf, 72)[0]
            mm = mmap.mmap(fd, length, mmap.MAP_SHARED, mmap.PROT_READ | mmap.PROT_WRITE, offset=offset)
            mapped.append(mm)
            q = bytearray(88)
            struct.pack_into('<II', q, 0, index, VIDEO_CAPTURE)
            struct.pack_into('<I', q, 60, MEMORY_MMAP)
            fcntl.ioctl(fd, QBUF, q, True)
        kind = ctypes.c_int(VIDEO_CAPTURE)
        fcntl.ioctl(fd, STREAMON, kind)
        streaming = True
        stream_on_ms = round((time.monotonic() - started) * 1000, 2)
        blobs = []
        timestamps = []
        first_dq = None
        for _ in range(frames):
            dq = bytearray(88)
            struct.pack_into('<II', dq, 0, 0, VIDEO_CAPTURE)
            struct.pack_into('<I', dq, 60, MEMORY_MMAP)
            deadline = time.monotonic() + 2
            while True:
                try:
                    fcntl.ioctl(fd, DQBUF, dq, True)
                    break
                except OSError as error:
                    if error.errno in (errno.EAGAIN, errno.EWOULDBLOCK) and time.monotonic() < deadline:
                        time.sleep(0.01)
                        continue
                    raise
            now = time.monotonic()
            if first_dq is None:
                first_dq = now
            index = struct.unpack_from('<I', dq, 0)[0]
            used = struct.unpack_from('<I', dq, 8)[0]
            sec, usec = struct.unpack_from('<qq', dq, 24)
            timestamps.append(sec * 1000 + usec / 1000)
            blobs.append(bytes(mapped[index][:used]))
            q = bytearray(88)
            struct.pack_into('<II', q, 0, index, VIDEO_CAPTURE)
            struct.pack_into('<I', q, 60, MEMORY_MMAP)
            fcntl.ioctl(fd, QBUF, q, True)
        with open(out_path, 'wb') as handle:
            for blob in blobs:
                handle.write(blob)
        deltas = []
        for prev, cur in zip(timestamps, timestamps[1:]):
            deltas.append(round(cur - prev, 3))
        return {
            'ok': True,
            'device': device,
            'path': out_path,
            'frames': len(blobs),
            'frameBytes': [len(blob) for blob in blobs],
            'width': fmt['width'],
            'height': fmt['height'],
            'pixelFormat': fmt['pixelFormat'],
            'streamOnMs': stream_on_ms,
            'firstFrameMs': round((first_dq - started) * 1000, 2) if first_dq else None,
            'interFrameMs': deltas,
            'closed': True,
        }
    finally:
        if streaming:
            try:
                fcntl.ioctl(fd, STREAMOFF, ctypes.c_int(VIDEO_CAPTURE))
            except OSError:
                pass
        for mm in mapped:
            mm.close()
        try:
            req = bytearray(20)
            struct.pack_into('<III', req, 0, 0, VIDEO_CAPTURE, MEMORY_MMAP)
            fcntl.ioctl(fd, REQBUFS, req, True)
        except OSError:
            pass
        os.close(fd)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit', action='store_true')
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--capture', action='store_true')
    parser.add_argument('--device', default='')
    parser.add_argument('--out', default='')
    parser.add_argument('--frames', type=int, default=8)
    parser.add_argument('--width', type=int, default=640)
    parser.add_argument('--height', type=int, default=480)
    args = parser.parse_args()
    if args.capture:
        if not args.device or not args.out:
            raise SystemExit('capture requires --device and --out')
        print(json.dumps(capture(args.device, args.out, max(1, min(args.frames, 300)), args.width, args.height)))
        return
    if args.open:
        if not args.device:
            raise SystemExit('open requires --device')
        print(json.dumps(open_probe(args.device, args.width, args.height)))
        return
    print(json.dumps(audit()))


if __name__ == '__main__':
    main()
