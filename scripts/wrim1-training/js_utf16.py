"""JavaScript-compatible UTF-16 code-unit slicing.

Wave 8.1 chunk offsets were produced by TypeScript String.prototype.slice,
which indexes UTF-16 code units, not Unicode code points. Python str slicing
is not equivalent when non-BMP characters are present.
"""
from __future__ import annotations


def js_slice(text: str, start: int, end: int) -> str:
    encoded = text.encode("utf-16-le")
    return encoded[int(start) * 2 : int(end) * 2].decode("utf-16-le")
