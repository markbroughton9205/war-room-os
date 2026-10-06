#!/usr/bin/env python3
"""Local MoveNet SinglePose Lightning inference through the system TFLite library.

No network. No face, hand, or identity model. CPU only.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import resource
import sys
import time
from pathlib import Path

from PIL import Image

KEYPOINTS = [
    'nose',
    'left_eye',
    'right_eye',
    'left_ear',
    'right_ear',
    'left_shoulder',
    'right_shoulder',
    'left_elbow',
    'right_elbow',
    'left_wrist',
    'right_wrist',
    'left_hip',
    'right_hip',
    'left_knee',
    'right_knee',
    'left_ankle',
    'right_ankle',
]

FLOAT32 = 1
INT32 = 2
UINT8 = 3
INT8 = 9
OK = 0


def load_lib():
    lib = ctypes.CDLL('libtensorflow-lite.so.2.14.1')
    lib.TfLiteModelCreateFromFile.argtypes = [ctypes.c_char_p]
    lib.TfLiteModelCreateFromFile.restype = ctypes.c_void_p
    lib.TfLiteModelDelete.argtypes = [ctypes.c_void_p]
    lib.TfLiteInterpreterOptionsCreate.restype = ctypes.c_void_p
    lib.TfLiteInterpreterOptionsDelete.argtypes = [ctypes.c_void_p]
    lib.TfLiteInterpreterOptionsSetNumThreads.argtypes = [ctypes.c_void_p, ctypes.c_int32]
    lib.TfLiteInterpreterCreate.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    lib.TfLiteInterpreterCreate.restype = ctypes.c_void_p
    lib.TfLiteInterpreterDelete.argtypes = [ctypes.c_void_p]
    lib.TfLiteInterpreterAllocateTensors.argtypes = [ctypes.c_void_p]
    lib.TfLiteInterpreterAllocateTensors.restype = ctypes.c_int
    lib.TfLiteInterpreterGetInputTensor.argtypes = [ctypes.c_void_p, ctypes.c_int32]
    lib.TfLiteInterpreterGetInputTensor.restype = ctypes.c_void_p
    lib.TfLiteInterpreterGetOutputTensor.argtypes = [ctypes.c_void_p, ctypes.c_int32]
    lib.TfLiteInterpreterGetOutputTensor.restype = ctypes.c_void_p
    lib.TfLiteInterpreterInvoke.argtypes = [ctypes.c_void_p]
    lib.TfLiteInterpreterInvoke.restype = ctypes.c_int
    lib.TfLiteTensorType.argtypes = [ctypes.c_void_p]
    lib.TfLiteTensorType.restype = ctypes.c_int
    lib.TfLiteTensorNumDims.argtypes = [ctypes.c_void_p]
    lib.TfLiteTensorNumDims.restype = ctypes.c_int32
    lib.TfLiteTensorDim.argtypes = [ctypes.c_void_p, ctypes.c_int32]
    lib.TfLiteTensorDim.restype = ctypes.c_int32
    lib.TfLiteTensorByteSize.argtypes = [ctypes.c_void_p]
    lib.TfLiteTensorByteSize.restype = ctypes.c_size_t
    lib.TfLiteTensorCopyFromBuffer.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
    lib.TfLiteTensorCopyFromBuffer.restype = ctypes.c_int
    lib.TfLiteTensorCopyToBuffer.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
    lib.TfLiteTensorCopyToBuffer.restype = ctypes.c_int
    return lib


def split_jpegs(blob: bytes) -> list[bytes]:
    frames = []
    start = 0
    while True:
        begin = blob.find(b'\xff\xd8', start)
        if begin < 0:
            break
        end = blob.find(b'\xff\xd9', begin + 2)
        if end < 0:
            break
        frames.append(blob[begin:end + 2])
        start = end + 2
    return frames


def letterbox(image: Image.Image, size: int) -> tuple[Image.Image, dict]:
    width, height = image.size
    scale = min(size / width, size / height)
    resized_w = max(1, int(round(width * scale)))
    resized_h = max(1, int(round(height * scale)))
    resized = image.resize((resized_w, resized_h), Image.Resampling.BILINEAR)
    canvas = Image.new('RGB', (size, size), (0, 0, 0))
    pad_x = (size - resized_w) // 2
    pad_y = (size - resized_h) // 2
    canvas.paste(resized, (pad_x, pad_y))
    raw = canvas.tobytes()
    luma = sum(raw[index] * 0.2126 + raw[index + 1] * 0.7152 + raw[index + 2] * 0.0722 for index in range(0, len(raw), 3)) / (len(raw) / 3)
    return canvas, {
        'sourceWidth': width,
        'sourceHeight': height,
        'modelInput': size,
        'resize': 'bilinear',
        'layout': 'letterbox',
        'padX': pad_x,
        'padY': pad_y,
        'scale': scale,
        'meanLuma': round(luma, 2),
    }


def input_bytes(canvas: Image.Image, tensor_type: int) -> tuple[bytes, str]:
    raw = canvas.tobytes()
    if tensor_type == UINT8:
        return raw, 'uint8 0-255'
    if tensor_type == FLOAT32:
        values = (ctypes.c_float * (len(raw)))(*(float(value) for value in raw))
        return bytes(values), 'float32 0-255'
    if tensor_type == INT32:
        values = (ctypes.c_int32 * (len(raw)))(*raw)
        return bytes(values), 'int32 0-255'
    raise RuntimeError(f'Unsupported MoveNet input type {tensor_type}.')


def unletterbox(x_norm: float, y_norm: float, meta: dict) -> tuple[float, float, bool]:
    size = meta['modelInput']
    x_px = x_norm * size
    y_px = y_norm * size
    src_x = (x_px - meta['padX']) / meta['scale']
    src_y = (y_px - meta['padY']) / meta['scale']
    inside = 0 <= src_x <= meta['sourceWidth'] and 0 <= src_y <= meta['sourceHeight']
    width = max(1, meta['sourceWidth'])
    height = max(1, meta['sourceHeight'])
    return max(0.0, min(1.0, src_x / width)), max(0.0, min(1.0, src_y / height)), inside


def infer_frames(model_path: str, images: list[Image.Image]) -> dict:
    lib = load_lib()
    model = lib.TfLiteModelCreateFromFile(model_path.encode())
    if not model:
        raise RuntimeError('TFLite could not open the MoveNet file.')
    options = lib.TfLiteInterpreterOptionsCreate()
    lib.TfLiteInterpreterOptionsSetNumThreads(options, 2)
    interpreter = lib.TfLiteInterpreterCreate(model, options)
    if not interpreter or lib.TfLiteInterpreterAllocateTensors(interpreter) != OK:
        raise RuntimeError('TFLite could not allocate MoveNet tensors.')
    input_tensor = lib.TfLiteInterpreterGetInputTensor(interpreter, 0)
    output_tensor = lib.TfLiteInterpreterGetOutputTensor(interpreter, 0)
    input_type = lib.TfLiteTensorType(input_tensor)
    dims = [lib.TfLiteTensorDim(input_tensor, index) for index in range(lib.TfLiteTensorNumDims(input_tensor))]
    if len(dims) != 4 or dims[1] != dims[2]:
        raise RuntimeError(f'Unexpected MoveNet input shape {dims}.')
    size = int(dims[1])
    output_size = lib.TfLiteTensorByteSize(output_tensor)
    frames = []
    latencies = []
    normalization = ''
    preprocess = None
    for index, image in enumerate(images):
        canvas, meta = letterbox(image.convert('RGB'), size)
        payload, normalization = input_bytes(canvas, input_type)
        buffer = ctypes.create_string_buffer(payload)
        if lib.TfLiteTensorCopyFromBuffer(input_tensor, buffer, len(payload)) != OK:
            raise RuntimeError('TFLite rejected the input frame.')
        started = time.perf_counter()
        if lib.TfLiteInterpreterInvoke(interpreter) != OK:
            raise RuntimeError('TFLite inference failed.')
        elapsed = (time.perf_counter() - started) * 1000
        latencies.append(elapsed)
        out = ctypes.create_string_buffer(output_size)
        if lib.TfLiteTensorCopyToBuffer(output_tensor, out, output_size) != OK:
            raise RuntimeError('TFLite could not read MoveNet output.')
        if output_size == 51 * 4:
            values = list(ctypes.cast(out, ctypes.POINTER(ctypes.c_float * 51)).contents)
        elif output_size == 51 * 2:
            values = [float(item) for item in ctypes.cast(out, ctypes.POINTER(ctypes.c_uint16 * 51)).contents]
        else:
            raise RuntimeError(f'Unexpected MoveNet output size {output_size}.')
        points = []
        for key_index, name in enumerate(KEYPOINTS):
            offset = key_index * 3
            y_norm, x_norm, score = values[offset], values[offset + 1], values[offset + 2]
            x, y, inside = unletterbox(float(x_norm), float(y_norm), meta)
            points.append({
                'name': name,
                'x': x,
                'y': y,
                'score': max(0.0, min(1.0, float(score))),
                'insideFrame': inside,
            })
        if preprocess is None:
            preprocess = meta
        frames.append({
            'index': index,
            'sourceWidth': meta['sourceWidth'],
            'sourceHeight': meta['sourceHeight'],
            'padX': meta['padX'],
            'padY': meta['padY'],
            'scale': meta['scale'],
            'meanLuma': meta['meanLuma'],
            'inferenceMs': round(elapsed, 3),
            'points': points,
        })
    lib.TfLiteInterpreterDelete(interpreter)
    lib.TfLiteInterpreterOptionsDelete(options)
    lib.TfLiteModelDelete(model)
    ordered = sorted(latencies)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return {
        'modelInput': size,
        'inputType': input_type,
        'normalization': normalization,
        'resize': 'bilinear',
        'layout': 'letterbox',
        'delegate': 'CPU',
        'frames': frames,
        'preprocess': preprocess,
        'latencyMs': {
            'mean': round(sum(latencies) / len(latencies), 3) if latencies else None,
            'median': round(ordered[len(ordered) // 2], 3) if ordered else None,
            'p95': round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))], 3) if ordered else None,
        },
        'cpuUserSeconds': round(usage.ru_utime, 3),
        'rssBytes': usage.ru_maxrss * 1024,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--mjpg', default='')
    parser.add_argument('--jpeg', default='')
    args = parser.parse_args()
    images = []
    if args.mjpg:
        images = [Image.open(__import__('io').BytesIO(blob)) for blob in split_jpegs(Path(args.mjpg).read_bytes())]
    elif args.jpeg:
        images = [Image.open(args.jpeg)]
    if not images:
        raise SystemExit('No JPEG frames were found.')
    json.dump(infer_frames(args.model, images), sys.stdout)


if __name__ == '__main__':
    main()
