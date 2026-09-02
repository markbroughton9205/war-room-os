"""Paths and helpers for the Wave 8.1R materialized WR-CORPUS-1-HARDENED bundle."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from paths import repo_root

BUNDLE_REL = "model-lab/corpora/WR-CORPUS-1-HARDENED"
RECOVERY_REL = "model-lab/manifests/wave8_1_recovery"
FROZEN_CORPUS_REL = "model-lab/manifests/wave8_1/corpus-manifest.json"
BEHAVIOR_REL = "model-lab/manifests/wave8_1/behavior-examples.json"
TOKENIZE_PAYLOAD_CANDIDATES = [
    "/var/folders/y2/lt5nz2_s0035j_ng0jytn1c00000gn/T/wave81-tokenize-9301.json",
    "/var/folders/y2/lt5nz2_s0035j_ng0jytn1c00000gn/T/wave81-tokenize-9268.json",
]


def bundle_dir(root: Optional[Path] = None) -> Path:
    return (root or repo_root()) / BUNDLE_REL


def recovery_dir(root: Optional[Path] = None) -> Path:
    return (root or repo_root()) / RECOVERY_REL
