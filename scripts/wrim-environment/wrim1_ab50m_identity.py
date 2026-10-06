"""WRIM1-FINAL-TOKENIZER-AND-AB50M-01 identity. Does not train by import."""
from __future__ import annotations

from pathlib import Path

from wrim_cpt_identity import AUTHORIZE_ENV, LINUX_DATA_ROOT, LINUX_VENV_PYTHON
from wrim_hvu_identity import CKPT_BASE
from wrim_pilot_ab_identity import CANONICAL, CANONICAL_HASH, SPECIAL_TOKENS

PROGRAM_ID = "WRIM1-FINAL-TOKENIZER-AND-AB50M-01"
AUTHORIZE_FLAG = "--authorize-wrim1-final-tokenizer-ab50m"
AUTHORIZE_ENV_VALUE = "ON_FOR_WRIM1_FINAL_TOKENIZER_AB50M_ONLY"
SEED = 20260924
EVAL_SEED = 42

DATA_ROOT = Path(LINUX_DATA_ROOT)
CORPUS_DIR = DATA_ROOT / "WRIM-1-PRETRAIN-CORPUS-v1.5.0"
CORPUS_HASH = "1eeeaf3711c2136e46a3b3507d9d96e3526ea36c230fcd003456c8d01dabe077"
TOKENIZER_DIR = DATA_ROOT / "WRIM1-TOKENIZER-v1"
PACK_DIR = DATA_ROOT / "WRIM1-AB50M-PACK-v1"
PROBE_DIR = DATA_ROOT / "WRIM1-DEEP-PROBES-v1"
CKPT_ROOT = Path(CKPT_BASE) / PROGRAM_ID
REPORT_PATH = DATA_ROOT / "WRIM1_FINAL_TOKENIZER_AB50M_REPORT.json"
PYTHON = LINUX_VENV_PYTHON
AUTHORIZE_ENV_NAME = AUTHORIZE_ENV

SEQ_LEN = 512
TOKENS_PER_STEP = 4096
MICRO_BATCH = 8
MAX_PHYSICAL_TOKENS = 50_000_000
STEPS = MAX_PHYSICAL_TOKENS // TOKENS_PER_STEP  # 12207
PHYSICAL_TOKENS = STEPS * TOKENS_PER_STEP  # 49_999_872
WARMUP_FRAC = 0.02
MIN_LR_FRAC = 0.10
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
GRAD_HARD = 8.0
PREFLIGHT_STEPS = 6
MICRO_EVAL_EVERY = 250
FULL_EVAL_FRACS = (0.10, 0.25, 0.50, 0.75, 1.0)

VOCAB_CANDIDATES = (16384, 24576, 32768)
LR_A = (1e-3, 1.5e-3, 3e-3)
LR_B = (5e-4, 1e-3, 1.5e-3)

ARCH_A = {
    "name": "WRIM1-A-23M-DEEP",
    "d_model": 256,
    "n_layers": 18,
    "n_heads": 4,
    "head_dim": 64,
    "d_ff": 768,
    "untied": True,
}
ARCH_B = {
    "name": "WRIM1-B-50M-DEEP",
    "d_model": 384,
    "n_layers": 20,
    "n_heads": 6,
    "head_dim": 64,
    "d_ff": 1152,
    "untied": True,
}

PHYSICAL_MIX = {
    "prose": 0.32,
    "conversation": 0.12,
    "instruction": 0.12,
    "code": 0.12,
    "technical": 0.07,
    "stem": 0.07,
    "math": 0.08,
    "procedural": 0.06,
    "json": 0.04,
}

DOMAIN_MAP = {
    "PROSE_GENERAL": "prose",
    "CONVERSATION_NATURAL": "conversation",
    "INSTRUCTION_RICH": "instruction",
    "CODE": "code",
    "TECHNICAL": "technical",
    "SCIENCE_STEM": "stem",
    "MATH_REASONING": "math",
    "PROCEDURAL": "procedural",
    "REFERENCE_FACTUAL": "procedural",
    "JSON_STRUCTURED": "json",
}

PILOT_TOKENIZER_HASH = "4fd0e8e1b8120fc027faae3d678d0257e872683577594671670587b4f55c9b52"
