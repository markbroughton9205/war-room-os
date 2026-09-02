from __future__ import annotations

from pathlib import Path

from constants import OFFICIAL_CKPT_DIR_REL, TEST_ONLY_DIR_REL, WAVE9_DIR_REL


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def wave9_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / WAVE9_DIR_REL


def test_only_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / TEST_ONLY_DIR_REL


def official_ckpt_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / OFFICIAL_CKPT_DIR_REL
